'use strict';

// SignalK plugin for Ecowitt GW2000B + WS90 all-in-one weather station
//
// Polls the GW2000B local HTTP API at: GET http://<host>/get_livedata_info
// No dynamic IP problem — we poll the GW2000B (fixed IP) rather than
// waiting for it to push to the Pi (dynamic IP).
//
// Actual GW2000B get_livedata_info response structure (observed):
//
//   common_list: array of {id, val, [unit]} — unit may be in val string or item.unit
//     0x02  outdoor temperature        val="16.4" unit="C"
//     0x03  dew point                  val="4.8"  unit="C"
//     0x07  outdoor humidity           val="46%"
//     0x0A  wind direction             val="15"   (degrees)
//     0x0B  wind speed                 val="6.22 knots"
//     0x0C  wind gust                  val="7.39 knots"
//     0x19  wind gust max daily        val="8.55 knots"
//     0x15  solar radiation            val="35.91 W/m2"
//     0x16  UV index                   val="2.4"
//     0x17  lightning strike count     val="0"
//     0x6D  lightning distance         val="357"  (km, when WH57 present)
//
//   piezoRain: array of {id, val} — val may include unit string
//     srain_piezo   rain event total    val="0"
//     0x0D          daily rain          val="0.0 mm"
//     0x0E          rain rate           val="0.0 mm/Hr"
//     0x7C          hourly rain         val="0.0 mm"
//     0x10          weekly rain         val="0.0 mm"
//     0x11          monthly rain        val="37.4 mm"
//     0x12          yearly rain         val="55.6 mm"
//     0x13          extra entry with:   battery, voltage, ws90cap_volt, ws90_ver
//
//   wh25: array with one entry (GW2000B built-in WH25 sensor):
//     intemp        indoor temperature  "24.1"  unit="C"
//     inhumi        indoor humidity     "43%"
//     abs           absolute pressure   "1012.9 hPa"
//     rel           relative pressure   "1012.9 hPa"

const http = require('http');

module.exports = function (app) {
  const plugin = {};

  let pollTimer = null;
  let stopped   = false;

  plugin.id          = 'signalk-ecowitt-gw2000';
  plugin.name        = 'Ecowitt GW2000B + WS90 Weather Station';
  plugin.description = 'Polls Ecowitt GW2000B local API for WS90 weather data and publishes to SignalK';

  plugin.schema = {
    type: 'object',
    required: ['host'],
    properties: {
      host: {
        type: 'string',
        title: 'GW2000B IP address',
        default: '192.168.0.35',
      },
      port: {
        type: 'number',
        title: 'GW2000B HTTP port',
        default: 80,
      },
      pollInterval: {
        type: 'number',
        title: 'Poll interval (seconds)',
        default: 60,
        minimum: 10,
        maximum: 300,
      },
      windAsTrue: {
        type: 'boolean',
        title: 'Publish wind as true wind (vs apparent)',
        default: false,
      },
    },
  };

  // ── Unit conversions ──────────────────────────────────────────────────────

  const DEG_TO_RAD = (d) => d * Math.PI / 180;

  // Convert wind speed to m/s (SignalK standard)
  function windToMs(val, unit) {
    switch ((unit || '').toLowerCase().trim()) {
      case 'km/h':              return val / 3.6;
      case 'mph':               return val * 0.44704;
      case 'knots': case 'kn': return val * 0.514444;
      default:                  return val; // m/s — no conversion needed
    }
  }

  // Convert temperature to Kelvin (SignalK standard)
  function tempToK(val, unit) {
    if ((unit || '').trim() === '°F' || (unit || '').trim() === 'F') return (val - 32) * 5 / 9 + 273.15;
    return val + 273.15; // °C default
  }

  // Convert pressure to Pa (SignalK standard)
  function pressureToPa(val, unit) {
    switch ((unit || '').toLowerCase().trim()) {
      case 'kpa':  return val * 1000;
      case 'inhg': return val * 3386.39;
      case 'mmhg': return val * 133.322;
      default:     return val * 100; // hPa default
    }
  }

  // Convert rain depth to m (SignalK standard)
  function rainToM(val, unit) {
    if ((unit || '').toLowerCase().trim() === 'in') return val * 0.0254;
    return val / 1000; // mm → m default
  }

  // Convert rain rate to m/s (SignalK standard)
  function rainRateToMs(val, unit) {
    const u = (unit || '').toLowerCase().trim();
    if (u === 'in/h' || u === 'in/hr') return val * 0.0254 / 3600;
    return val / 3600000; // mm/hr → m/s default
  }

  // ── HTTP polling ──────────────────────────────────────────────────────────

  function fetchLiveData(options) {
    return new Promise((resolve, reject) => {
      const req = http.get({
        hostname: options.host,
        port: options.port || 80,
        path: '/get_livedata_info',
        timeout: 5000,
      }, (res) => {
        // Bug fix: reject on non-2xx status codes
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume(); // drain so socket is reused
          return reject(new Error(`HTTP ${res.statusCode} from GW2000B`));
        }
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        // Bug fix: handle errors emitted on the response (e.g. connection reset mid-transfer)
        res.on('error', reject);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message} — Body: ${body.slice(0, 200)}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    });
  }

  // ── Field extraction helpers ──────────────────────────────────────────────

  // GW2000B mixes two formats: {id, val, unit} and {id, val:"6.22 knots"}.
  // This extracts a numeric value and unit string from either form.
  function parseValAndUnit(item) {
    if (item.unit !== undefined) {
      return { val: parseFloat(item.val), unit: String(item.unit).trim() };
    }
    // Extract trailing unit from val string: "6.22 knots" → {val:6.22, unit:"knots"}
    const m = String(item.val).trim().match(/^(-?[\d.]+)\s*(.*)$/);
    if (m) return { val: parseFloat(m[1]), unit: m[2].trim() };
    return { val: parseFloat(item.val), unit: '' };
  }

  // common_list is an array of {id, val, [unit]} — returns { map, units }
  function buildCommonMap(data) {
    const map = {};
    const units = {};
    const list = data?.common_list ?? [];
    for (const item of list) {
      if (item.id === undefined || item.val === undefined) continue;
      const { val, unit } = parseValAndUnit(item);
      // Filter NaN — GW2000B sends "--" for missing sensors
      if (!isNaN(val)) { map[item.id] = val; units[item.id] = unit; }
    }
    return { map, units };
  }

  // piezoRain is an array of {id, val, ...extraFields}
  // Extra scalar fields (ws90cap_volt, voltage, battery) are also extracted.
  function buildPiezoMap(data) {
    const map = {};
    const units = {};
    const raw = data?.piezoRain;
    if (!raw) return { map, units };

    // Handle both array format (observed) and flat-object format (backwards compat)
    const list = Array.isArray(raw)
      ? raw
      : Object.entries(raw).map(([id, val]) => ({ id, val }));

    for (const item of list) {
      if (item.id !== undefined && item.val !== undefined) {
        const { val, unit } = parseValAndUnit(item);
        if (!isNaN(val)) { map[item.id] = val; units[item.id] = unit; }
      }
      // Extract extra scalar fields on this entry (ws90cap_volt, voltage, etc.)
      for (const [k, v] of Object.entries(item)) {
        if (k === 'id' || k === 'val') continue;
        const n = parseFloat(v);
        if (!isNaN(n)) { map[k] = n; units[k] = ''; }
      }
    }
    return { map, units };
  }

  // ── Data parsing and SignalK publishing ───────────────────────────────────

  function parseAndPublish(data, options) {
    const { map: common, units: commonUnits } = buildCommonMap(data);
    const { map: piezo, units: piezoUnits }   = buildPiezoMap(data);
    const values = [];

    // ── Outdoor temperature & humidity ────────────────────────────────────
    if (common['0x02'] !== undefined)
      values.push({ path: 'environment.outside.temperature',          value: tempToK(common['0x02'], commonUnits['0x02']) });

    if (common['0x03'] !== undefined)
      values.push({ path: 'environment.outside.dewPointTemperature',  value: tempToK(common['0x03'], commonUnits['0x03']) });

    if (common['0x07'] !== undefined)
      values.push({ path: 'environment.outside.humidity',             value: common['0x07'] / 100 });

    // ── Wind ─────────────────────────────────────────────────────────────
    const windDir     = common['0x0A'];
    const windSpeed   = common['0x0B'];
    const windGust    = common['0x0C'];
    const windGustMax = common['0x19'];

    if (windDir !== undefined) {
      const path = options.windAsTrue ? 'environment.wind.directionTrue' : 'environment.wind.directionApparent';
      values.push({ path, value: DEG_TO_RAD(windDir) });
    }

    if (windSpeed !== undefined) {
      const path = options.windAsTrue ? 'environment.wind.speedTrue' : 'environment.wind.speedApparent';
      values.push({ path, value: windToMs(windSpeed, commonUnits['0x0B']) });
    }

    if (windGust !== undefined)
      values.push({ path: 'environment.wind.gustSpeed',       value: windToMs(windGust,    commonUnits['0x0C']) });

    if (windGustMax !== undefined)
      values.push({ path: 'environment.wind.gustSpeedMaxDay', value: windToMs(windGustMax, commonUnits['0x19']) });

    // ── Solar radiation & UV ─────────────────────────────────────────────
    if (common['0x15'] !== undefined)
      values.push({ path: 'environment.outside.solarRadiation', value: common['0x15'] });

    if (common['0x16'] !== undefined)
      values.push({ path: 'environment.outside.uvIndex',         value: common['0x16'] });

    // ── Lightning ────────────────────────────────────────────────────────
    if (common['0x17'] !== undefined)
      values.push({ path: 'environment.outside.lightningStrikeCount', value: common['0x17'] });

    if (common['0x6D'] !== undefined)
      values.push({ path: 'environment.outside.lightningDistance', value: common['0x6D'] * 1000 }); // km→m

    // ── Rain (WS90 piezo sensor) ─────────────────────────────────────────
    // Rain rate is in 0x0E ("0.0 mm/Hr"), not rrain_piezo
    if (piezo['0x0E'] !== undefined)
      values.push({ path: 'environment.outside.rainRate',       value: rainRateToMs(piezo['0x0E'], piezoUnits['0x0E']) });

    if (piezo['srain_piezo'] !== undefined)
      values.push({ path: 'environment.outside.rainEventTotal', value: rainToM(piezo['srain_piezo'], piezoUnits['srain_piezo']) });

    const rainFields = {
      '0x0D': 'environment.outside.rainDayTotal',
      '0x7C': 'environment.outside.rainHourTotal',
      '0x10': 'environment.outside.rainWeekTotal',
      '0x11': 'environment.outside.rainMonthTotal',
      '0x12': 'environment.outside.rainYearTotal',
    };
    for (const [id, path] of Object.entries(rainFields)) {
      if (piezo[id] !== undefined)
        values.push({ path, value: rainToM(piezo[id], piezoUnits[id]) });
    }

    // ── Indoor + Pressure (GW2000B WH25 built-in sensor) ─────────────────
    // API returns this as data.wh25[0] with fields: intemp, inhumi, abs, rel
    const wh25 = Array.isArray(data?.wh25) ? data.wh25[0] : data?.wh25;
    if (wh25) {
      if (wh25.intemp !== undefined)
        values.push({ path: 'environment.inside.temperature', value: tempToK(parseFloat(wh25.intemp), wh25.unit) });

      if (wh25.inhumi !== undefined)
        values.push({ path: 'environment.inside.humidity',    value: parseFloat(wh25.inhumi) / 100 });

      if (wh25.abs !== undefined) {
        const { val, unit } = parseValAndUnit({ val: wh25.abs });
        values.push({ path: 'environment.outside.pressure',         value: pressureToPa(val, unit) });
      }
      if (wh25.rel !== undefined) {
        const { val, unit } = parseValAndUnit({ val: wh25.rel });
        values.push({ path: 'environment.outside.pressureSeaLevel', value: pressureToPa(val, unit) });
      }
    }

    // ── WS90 battery / capacitor voltage ─────────────────────────────────
    if (piezo['ws90cap_volt'] !== undefined)
      values.push({ path: 'electrical.batteries.ws90.voltage',       value: piezo['ws90cap_volt'] });

    // Backup battery voltage field is 'voltage' in the observed API response
    if (piezo['voltage'] !== undefined)
      values.push({ path: 'electrical.batteries.ws90backup.voltage', value: piezo['voltage'] });

    if (values.length === 0) {
      app.debug('No recognised fields in GW2000B response — check field mapping');
      app.debug('Raw response: ' + JSON.stringify(data).slice(0, 500));
      return;
    }

    app.handleMessage(plugin.id, {
      updates: [{
        source: { label: plugin.id },
        values,
      }],
    });

    app.debug(`Published ${values.length} values from GW2000B`);
  }

  // ── Poll loop ─────────────────────────────────────────────────────────────

  async function poll(options) {
    try {
      const data = await fetchLiveData(options);
      if (stopped) return; // plugin stopped while request was in-flight
      parseAndPublish(data, options);
      app.setPluginStatus(`Connected — ${options.host}`);
    } catch (err) {
      if (stopped) return;
      app.error(`GW2000B poll error: ${err.message}`);
      app.setPluginError(err.message);
    }
  }

  // ── Plugin lifecycle ──────────────────────────────────────────────────────

  plugin.start = function (opts) {
    // Guard against double-start (plugin reload without stop)
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    stopped = false;

    const options = {
      host:         opts?.host         || '192.168.0.35',
      port:         opts?.port         || 80,
      pollInterval: opts?.pollInterval || 16,
      windAsTrue:   opts?.windAsTrue   !== false,
    };

    app.debug(`Starting — polling http://${options.host}:${options.port}/get_livedata_info every ${options.pollInterval}s`);
    app.setPluginStatus(`Connecting to ${options.host}…`);

    // Poll immediately, then on interval
    poll(options);
    pollTimer = setInterval(() => poll(options), options.pollInterval * 1000);
  };

  plugin.stop = function () {
    stopped = true;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    app.debug('Plugin stopped');
  };

  return plugin;
};

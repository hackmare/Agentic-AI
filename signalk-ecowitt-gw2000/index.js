'use strict';

// SignalK plugin for Ecowitt GW2000B + WS90 all-in-one weather station
//
// Polls the GW2000B local HTTP API at: GET http://<host>/get_livedata_info
// No dynamic IP problem — we poll the GW2000B (fixed IP) rather than
// waiting for it to push to the Pi (dynamic IP).
//
// WS90 fields received from GW2000B get_livedata_info (JSON):
//
//   common list (keyed by hex ID) — each entry has {id, val, unit}:
//     0x02  outdoor temperature        °C or °F  (hub configured)
//     0x03  dew point                  °C or °F
//     0x07  outdoor humidity           %
//     0x0A  wind direction             ° (0-359)
//     0x0B  wind speed                 m/s, km/h, mph, or knots (hub configured)
//     0x0C  wind gust                  m/s, km/h, mph, or knots
//     0x19  wind gust max daily        m/s, km/h, mph, or knots
//     0x15  solar radiation            W/m²
//     0x16  UV index                   (0-16)
//     0x17  lightning strike count     count
//     0x6D  lightning distance         km (when WH57 present)
//
//   piezoRain section (WS90 piezo rain sensor):
//     rrain_piezo   rain rate           mm/hr or in/hr (hub configured)
//     srain_piezo   rain event total    mm or in
//     0x0D          daily rain          mm
//     0x0E          rain rate           mm/hr
//     0x7C          hourly rain         mm
//     0x10          weekly rain         mm
//     0x11          monthly rain        mm
//     0x12          yearly rain         mm
//     ws90cap_volt  capacitor voltage   V  (solar charged)
//     wh90batt      battery voltage     V  (backup AA)
//     ws90_ver      firmware version
//
//   indoor (from GW2000B itself):
//     intemp        indoor temperature  °C
//     inhumi        indoor humidity     %
//     absbaro       absolute pressure   hPa
//     relbaro       relative pressure   hPa

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

  // Convert wind speed from whatever unit the hub reports to m/s (SignalK standard)
  function windToMs(val, unit) {
    switch ((unit || '').toLowerCase().trim()) {
      case 'km/h':              return val / 3.6;
      case 'mph':               return val * 0.44704;
      case 'knots': case 'kn': return val * 0.514444;
      default:                  return val; // m/s — no conversion needed
    }
  }

  // Convert temperature from whatever unit the hub reports to Kelvin (SignalK standard)
  function tempToK(val, unit) {
    if ((unit || '').trim() === '°F' || (unit || '').trim() === 'F') return (val - 32) * 5 / 9 + 273.15;
    return val + 273.15; // °C default
  }

  // Convert pressure from whatever unit the hub reports to Pa (SignalK standard)
  function pressureToPa(val, unit) {
    switch ((unit || '').toLowerCase().trim()) {
      case 'inhg': return val * 3386.39;
      case 'mmhg': return val * 133.322;
      default:     return val * 100; // hPa default
    }
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

  // GW2000B returns common list as an array of {id, val, unit} objects
  // where id is a hex string like "0x02"
  // Returns { map: {id → number}, units: {id → unit string} }
  function buildCommonMap(data) {
    const map = {};
    const units = {};
    const list = data?.common_list ?? [];
    for (const item of list) {
      if (item.id !== undefined && item.val !== undefined) {
        const n = parseFloat(item.val);
        // Bug fix: filter NaN (GW2000B sends "--" for missing sensors)
        if (!isNaN(n)) {
          map[item.id]   = n;
          units[item.id] = item.unit ?? '';
        }
      }
    }
    return { map, units };
  }

  // piezoRain is an object with mixed named keys and hex-id keys
  function buildPiezoMap(data) {
    const raw = data?.piezoRain ?? {};
    const map = {};
    for (const [k, v] of Object.entries(raw)) {
      const n = parseFloat(v);
      if (!isNaN(n)) map[k] = n;
    }
    return map;
  }

  // ── Data parsing and SignalK publishing ───────────────────────────────────

  function parseAndPublish(data, options) {
    const { map: common, units: commonUnits } = buildCommonMap(data);
    const piezo  = buildPiezoMap(data);
    const values  = [];

    // ── Outdoor temperature & humidity ────────────────────────────────────
    if (common['0x02'] !== undefined)
      values.push({ path: 'environment.outside.temperature',   value: tempToK(common['0x02'], commonUnits['0x02']) });

    if (common['0x03'] !== undefined)
      values.push({ path: 'environment.outside.dewPointTemperature', value: tempToK(common['0x03'], commonUnits['0x03']) });

    if (common['0x07'] !== undefined)
      values.push({ path: 'environment.outside.humidity',      value: common['0x07'] / 100 });

    // ── Wind ─────────────────────────────────────────────────────────────
    const windDir     = common['0x0A'];
    const windSpeed   = common['0x0B'];
    const windGust    = common['0x0C'];
    const windGustMax = common['0x19'];

    if (windDir !== undefined) {
      const path = options.windAsTrue
        ? 'environment.wind.directionTrue'
        : 'environment.wind.directionApparent';
      values.push({ path, value: DEG_TO_RAD(windDir) });
    }

    if (windSpeed !== undefined) {
      const path = options.windAsTrue
        ? 'environment.wind.speedTrue'
        : 'environment.wind.speedApparent';
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
    if (piezo['rrain_piezo'] !== undefined)
      values.push({ path: 'environment.outside.rainRate',         value: piezo['rrain_piezo'] / 3600 }); // mm/hr→mm/s

    if (piezo['srain_piezo'] !== undefined)
      values.push({ path: 'environment.outside.rainEventTotal',   value: piezo['srain_piezo'] / 1000 }); // mm→m

    // Daily / hourly / weekly / monthly / yearly rain totals
    const rainFields = {
      '0x0D': 'environment.outside.rainDayTotal',
      '0x7C': 'environment.outside.rainHourTotal',
      '0x10': 'environment.outside.rainWeekTotal',
      '0x11': 'environment.outside.rainMonthTotal',
      '0x12': 'environment.outside.rainYearTotal',
    };
    for (const [id, path] of Object.entries(rainFields)) {
      if (piezo[id] !== undefined)
        values.push({ path, value: piezo[id] / 1000 }); // mm→m
    }

    // ── Indoor (GW2000B built-in sensor) ─────────────────────────────────
    if (data?.indoor) {
      const indoor = data.indoor;
      if (indoor.temperature !== undefined)
        values.push({ path: 'environment.inside.temperature', value: tempToK(parseFloat(indoor.temperature), indoor.temperature_unit) });
      if (indoor.humidity !== undefined)
        values.push({ path: 'environment.inside.humidity',    value: parseFloat(indoor.humidity) / 100 });
    }

    // ── Barometric pressure ───────────────────────────────────────────────
    if (data?.pressure) {
      const pressure = data.pressure;
      if (pressure.absolute !== undefined)
        values.push({ path: 'environment.outside.pressure',         value: pressureToPa(parseFloat(pressure.absolute), pressure.unit) });
      if (pressure.relative !== undefined)
        values.push({ path: 'environment.outside.pressureSeaLevel', value: pressureToPa(parseFloat(pressure.relative), pressure.unit) });
    }

    // ── WS90 battery / capacitor voltage ─────────────────────────────────
    if (piezo['ws90cap_volt'] !== undefined)
      values.push({ path: 'electrical.batteries.ws90.voltage', value: piezo['ws90cap_volt'] });

    if (piezo['wh90batt'] !== undefined)
      values.push({ path: 'electrical.batteries.ws90backup.voltage', value: piezo['wh90batt'] });

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

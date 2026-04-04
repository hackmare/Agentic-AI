'use strict';

// HCALORY TB2S Diesel Heater — SignalK BLE Plugin
//
// BLE Protocol (reverse-engineered from nRF Connect logs, April 2026):
//   Service:        0000BD39-0000-1000-8000-00805F9B34FB
//   Write char:     0000BDF7-0000-1000-8000-00805F9B34FB  (WRITE, WRITE NO RESPONSE)
//   Notify char:    0000BDF8-0000-1000-8000-00805F9B34FB  (NOTIFY, READ, WRITE)
//
// Notification packet format (35-byte payload, most common status packet):
//   [0]     0x00       SOF
//   [1]     0x01/0x03  category
//   [2-6]   fixed      00 01 00 01 00
//   [7]     0x23       payload length (35)
//   [8]     0x03       sub-type
//   [9-10]  0x00 0x00
//   [11]    0x1E       sub-payload length
//   [12-13] 0xFF 0xFF
//   [14]    0x03
//   [15]    voltage1   supply voltage × 10 (e.g. 0x84 = 13.2 V)
//   [16-19] 0x00...
//   [20]    state      heater state (see HEATER_STATE map)
//   [21]    mode       0x00=off, 0x01=thermostat, 0x02=gear, 0x03=startup
//   [22]    setting    thermostat: target temp °C | gear: gear level 1–10 | startup: glow step
//   [23]    subState   0x01=stable-off/cooldown-end, 0x02=active
//   [24]    0x00
//   [25]    voltage2   secondary voltage × 10
//   [26]    0x00
//   [27-28] chamberT   heater chamber temp, big-endian ÷ 10 → °C (e.g. 0x0898 = 220.0°C)
//   [29-30] 0x00 0x00
//   [31]    unknown
//   [32-41] 0x00...
//   [42]    checksum   sum(bytes[8..41]) mod 256
//
// Full startup sequence observed (byte [20] transitions):
//   0x00 (off) → 0xC1 (pre-heat/glow) → 0x01 (transitioning) →
//   0x80 (self-test 1) → 0x81 (self-test 2) → 0x83 (igniting) → 0x85 (running)
// Shutdown sequence:
//   0x85 (running) → 0x44/0x43/0x45 (cooling down) → 0x00 (off)
//
// Write command format (inferred from evanfoster/hcalory-control + packet structure):
//   00-02-00-01-00-01-00-0E-04-00-00-09-00-00-00-00-00-00-00-CMD-CHECKSUM
//   CHECKSUM = (0x04 + 0x09 + CMD) & 0xFF = (0x0D + CMD) & 0xFF
//   NOTE: commands are EXPERIMENTAL — validate with physical testing before relying on them.

module.exports = function (app) {
  const plugin = {};

  // ── BLE UUIDs (noble format: lowercase, no dashes) ──────────────────────
  const SERVICE_UUID  = '0000bd3900001000800000805f9b34fb';
  const WRITE_UUID    = '0000bdf700001000800000805f9b34fb';
  const NOTIFY_UUID   = '0000bdf800001000800000805f9b34fb';

  // ── Heater state codes (byte [20]) ──────────────────────────────────────
  // Confirmed from nRF Connect log analysis (April 2026)
  const HEATER_STATE = {
    0x00: 'off',
    0x01: 'transitioning',
    0x43: 'cooling-down',
    0x44: 'cooling-down',
    0x45: 'cooling-down',
    0x80: 'self-test',
    0x81: 'self-test',
    0x83: 'igniting',
    0x85: 'running',
    0xC1: 'pre-heat',
    0xFF: 'error',
  };

  // ── Mode codes (byte [21]) ───────────────────────────────────────────────
  const HEATER_MODE = {
    0x00: 'off',
    0x01: 'thermostat',
    0x02: 'gear',
    0x03: 'startup',
  };


  // ── Write command bytes (EXPERIMENTAL) ──────────────────────────────────
  const CMD = {
    POLL:            0x00,
    STOP:            0x01,
    START:           0x02,
    TEMP_UP:         0x03,
    TEMP_DOWN:       0x04,
    MODE_THERMOSTAT: 0x06,
    MODE_GEAR:       0x07,
  };

  // Static prefix for write commands (based on evanfoster/hcalory-control protocol)
  const CMD_PREFIX = Buffer.from([
    0x00, 0x02, 0x00, 0x01, 0x00, 0x01, 0x00,  // header
    0x0E,                                         // payload length = 14
    0x04, 0x00, 0x00, 0x09,                       // sub-header
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,    // padding
  ]);

  // Runtime state
  let noble       = null;
  let heaterPeripheral = null;
  let writeChar   = null;
  let notifyChar  = null;
  let reconnectTimer  = null;
  let keepaliveTimer  = null;
  let scanning    = false;
  let options     = {};

  // ── Plugin metadata ──────────────────────────────────────────────────────
  plugin.id          = 'signalk-hcalory-heater';
  plugin.name        = 'HCALORY Diesel Heater (BLE)';
  plugin.description = 'Monitor and control HCALORY TB2S diesel heater via Bluetooth LE';

  plugin.schema = {
    type: 'object',
    required: ['deviceName'],
    properties: {
      deviceName: {
        type: 'string',
        title: 'Heater BLE device name (as shown in nRF Connect)',
        default: 'Heater5949',
      },
      pollInterval: {
        type: 'number',
        title: 'Poll / keepalive interval (seconds)',
        default: 2,
        minimum: 1,
        maximum: 10,
      },
      enableControl: {
        type: 'boolean',
        title: 'Enable experimental write commands (on/off, temp, mode)',
        default: false,
      },
    },
  };

  // ── Packet parsing ───────────────────────────────────────────────────────

  function verifyChecksum(data) {
    if (data.length < 9) return false;
    const payloadLen = data[7];
    if (data.length < 8 + payloadLen) return false;
    let sum = 0;
    for (let i = 8; i < 8 + payloadLen - 1; i++) sum += data[i];
    return (sum & 0xFF) === data[8 + payloadLen - 1];
  }

  function parsePacket(data) {
    if (data.length < 8) return null;

    const payloadLen = data[7];
    if (data.length < 8 + payloadLen) return null;

    if (!verifyChecksum(data)) {
      app.debug('Checksum mismatch — skipping packet');
      return null;
    }

    // Main status packet: 35-byte payload (0x23), sub-type 0x03
    if (payloadLen === 0x23 && data[8] === 0x03) {
      return parseStatusPacket(data);
    }

    // Other packet types (sensor sub-packets, config) — not yet decoded
    app.debug(`Unhandled packet type: payloadLen=0x${payloadLen.toString(16)}, subType=0x${data[8].toString(16)}`);
    return null;
  }

  function parseStatusPacket(data) {
    const supplyVoltage    = data[15] / 10;
    const heaterStateRaw   = data[20];
    const modeRaw          = data[21];
    const settingRaw       = data[22];
    const subState         = data[23];
    const secondaryVoltage = data[25] / 10;
    const chamberTempRaw   = (data[27] << 8) | data[28];
    const chamberTemp      = chamberTempRaw / 10;  // °C

    const heaterState = HEATER_STATE[heaterStateRaw]
      ?? `unknown(0x${heaterStateRaw.toString(16)})`;
    const mode = HEATER_MODE[modeRaw]
      ?? `unknown(0x${modeRaw.toString(16)})`;

    // [22] meaning depends on mode:
    //   thermostat (0x01): target temperature in °C
    //   gear (0x02):       gear level 1–10
    //   startup (0x03):    glow plug power step
    //   off (0x00):        last target temp or 0
    const targetTemperature = (modeRaw === 0x01) ? settingRaw : null;
    const gearLevel         = (modeRaw === 0x02) ? settingRaw : null;

    return {
      heaterState,
      heaterStateRaw,
      mode,
      modeRaw,
      settingRaw,
      targetTemperature,
      gearLevel,
      subState,
      supplyVoltage,
      secondaryVoltage,
      chamberTemp,
    };
  }

  // ── SignalK delta publishing ──────────────────────────────────────────────

  function publishDeltas(parsed) {
    const C_TO_K = 273.15;
    const values = [
      { path: 'propulsion.heater.state',            value: parsed.heaterState      },
      { path: 'propulsion.heater.mode',             value: parsed.mode             },
      { path: 'propulsion.heater.voltage',          value: parsed.supplyVoltage    },
      { path: 'propulsion.heater.voltageSecondary', value: parsed.secondaryVoltage },
      // SignalK standard: temperatures in Kelvin
      { path: 'propulsion.heater.chamberTemperature',
        value: parsed.chamberTemp + C_TO_K },
    ];

    // Only publish target temp when in thermostat mode
    if (parsed.targetTemperature !== null) {
      values.push({ path: 'propulsion.heater.targetTemperature',
        value: parsed.targetTemperature + C_TO_K });
    }

    // Only publish gear level when in gear mode
    if (parsed.gearLevel !== null) {
      values.push({ path: 'propulsion.heater.gearLevel', value: parsed.gearLevel });
    }

    app.handleMessage(plugin.id, {
      updates: [{
        source: { label: plugin.id },
        values,
      }],
    });
  }

  // ── Write command builder ─────────────────────────────────────────────────

  function buildCommand(cmdByte) {
    const packet = Buffer.alloc(CMD_PREFIX.length + 2);
    CMD_PREFIX.copy(packet);
    packet[CMD_PREFIX.length]     = cmdByte;
    packet[CMD_PREFIX.length + 1] = (0x0D + cmdByte) & 0xFF;  // checksum
    return packet;
  }

  function sendCommand(cmdByte) {
    if (!writeChar) {
      app.debug('Write characteristic not available');
      return;
    }
    const packet = buildCommand(cmdByte);
    app.debug(`Sending command 0x${cmdByte.toString(16)}: ${packet.toString('hex')}`);
    writeChar.write(packet, true, (err) => {
      if (err) app.debug(`Write error: ${err}`);
    });
  }

  // ── BLE connection management ─────────────────────────────────────────────

  function onNotification(data) {
    app.debug(`Notification (${data.length} bytes): ${data.toString('hex')}`);
    const parsed = parsePacket(data);
    if (parsed) publishDeltas(parsed);
  }

  function connectToPeripheral(peripheral) {
    heaterPeripheral = peripheral;
    app.debug(`Connecting to ${peripheral.advertisement.localName} …`);

    peripheral.connect((err) => {
      if (err) {
        app.debug(`Connect error: ${err}`);
        return scheduleReconnect();
      }

      peripheral.discoverServices([SERVICE_UUID], (err, services) => {
        if (err || !services || services.length === 0) {
          app.debug(`Service discovery failed: ${err}`);
          peripheral.disconnect();
          return scheduleReconnect();
        }

        services[0].discoverCharacteristics([], (err, chars) => {
          if (err || !chars) {
            app.debug(`Characteristic discovery failed: ${err}`);
            peripheral.disconnect();
            return scheduleReconnect();
          }

          for (const c of chars) {
            if (c.uuid === WRITE_UUID)   writeChar  = c;
            if (c.uuid === NOTIFY_UUID)  notifyChar = c;
          }

          if (!notifyChar) {
            app.debug('Notify characteristic not found — wrong device?');
            peripheral.disconnect();
            return scheduleReconnect();
          }

          notifyChar.subscribe((err) => {
            if (err) {
              app.debug(`Subscribe error: ${err}`);
              peripheral.disconnect();
              return scheduleReconnect();
            }

            app.debug('Subscribed to notifications — heater connected');
            notifyChar.on('data', onNotification);

            // Send initial poll and start keepalive
            sendCommand(CMD.POLL);
            startKeepalive();
          });
        });
      });
    });

    peripheral.once('disconnect', () => {
      app.debug('Heater disconnected');
      writeChar  = null;
      notifyChar = null;
      stopKeepalive();
      heaterPeripheral = null;
      scheduleReconnect();
    });
  }

  function startKeepalive() {
    stopKeepalive();
    const intervalMs = (options.pollInterval || 2) * 1000;
    keepaliveTimer = setInterval(() => sendCommand(CMD.POLL), intervalMs);
  }

  function stopKeepalive() {
    if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
  }

  function scheduleReconnect() {
    writeChar  = null;
    notifyChar = null;
    stopKeepalive();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(startScanning, 8000);
    app.debug('Reconnecting in 8 s …');
  }

  function startScanning() {
    if (scanning || !noble) return;
    app.debug(`Scanning for "${options.deviceName}" …`);
    scanning = true;
    noble.startScanning([], false, (err) => {
      if (err) {
        app.debug(`Scan start error: ${err}`);
        scanning = false;
        scheduleReconnect();
      }
    });
  }

  // ── PUT handlers (control) ───────────────────────────────────────────────

  function requireControl(reply) {
    if (!options.enableControl) {
      reply({ state: 'COMPLETED', statusCode: 405,
              message: 'Enable "experimental write commands" in plugin settings first' });
      return false;
    }
    if (!writeChar) {
      reply({ state: 'COMPLETED', statusCode: 503, message: 'Heater not connected' });
      return false;
    }
    return true;
  }

  function handlePutState(context, path, value, reply) {
    if (!requireControl(reply)) return true;
    if (value === 'on' || value === true || value === 1) {
      sendCommand(CMD.START);
    } else {
      sendCommand(CMD.STOP);
    }
    reply({ state: 'COMPLETED', statusCode: 200 });
    return true;
  }

  function handlePutTargetTemp(context, path, value, reply) {
    if (!requireControl(reply)) return true;
    // value is Kelvin (SignalK standard); heater works in °C integers 1-step increments
    // We can only increment/decrement by 1°C — the app doesn't support absolute set
    app.debug(`PUT targetTemperature: ${(value - 273.15).toFixed(1)}°C requested`);
    app.debug('NOTE: heater protocol only supports +1/−1°C steps; send multiple commands for larger changes');
    // TODO: read current setting and send the right number of up/down commands
    reply({ state: 'COMPLETED', statusCode: 200,
            message: 'Single-step increment/decrement only; absolute temperature set not supported' });
    return true;
  }

  function handlePutTempUp(context, path, value, reply) {
    if (!requireControl(reply)) return true;
    sendCommand(CMD.TEMP_UP);
    reply({ state: 'COMPLETED', statusCode: 200 });
    return true;
  }

  function handlePutTempDown(context, path, value, reply) {
    if (!requireControl(reply)) return true;
    sendCommand(CMD.TEMP_DOWN);
    reply({ state: 'COMPLETED', statusCode: 200 });
    return true;
  }

  function handlePutMode(context, path, value, reply) {
    if (!requireControl(reply)) return true;
    if (value === 'thermostat') {
      sendCommand(CMD.MODE_THERMOSTAT);
    } else if (value === 'gear') {
      sendCommand(CMD.MODE_GEAR);
    } else {
      reply({ state: 'COMPLETED', statusCode: 400, message: 'mode must be "thermostat" or "gear"' });
      return true;
    }
    reply({ state: 'COMPLETED', statusCode: 200 });
    return true;
  }

  // ── Plugin lifecycle ──────────────────────────────────────────────────────

  plugin.start = function (opts) {
    options = opts || {};
    options.deviceName   = options.deviceName   || 'Heater5949';
    options.pollInterval = options.pollInterval  || 2;

    try {
      noble = require('@abandonware/noble');
    } catch (e) {
      app.error('Cannot load @abandonware/noble. On the Pi, run: sudo npm install -g @abandonware/noble');
      return;
    }

    noble.on('stateChange', (state) => {
      app.debug(`Bluetooth state: ${state}`);
      if (state === 'poweredOn') {
        startScanning();
      } else {
        noble.stopScanning();
        scanning = false;
      }
    });

    noble.on('discover', (peripheral) => {
      const name = peripheral.advertisement && peripheral.advertisement.localName;
      if (name === options.deviceName) {
        app.debug(`Found heater: ${name} (${peripheral.address})`);
        noble.stopScanning();
        scanning = false;
        connectToPeripheral(peripheral);
      }
    });

    // Register PUT handlers
    app.registerPutHandler('vessels.self', 'propulsion.heater.state',
      handlePutState, plugin.id);
    app.registerPutHandler('vessels.self', 'propulsion.heater.targetTemperature',
      handlePutTargetTemp, plugin.id);
    app.registerPutHandler('vessels.self', 'propulsion.heater.tempUp',
      handlePutTempUp, plugin.id);
    app.registerPutHandler('vessels.self', 'propulsion.heater.tempDown',
      handlePutTempDown, plugin.id);
    app.registerPutHandler('vessels.self', 'propulsion.heater.mode',
      handlePutMode, plugin.id);

    app.debug(`Plugin started — looking for "${options.deviceName}"`);
  };

  plugin.stop = function () {
    stopKeepalive();
    if (reconnectTimer)      clearTimeout(reconnectTimer);
    if (noble)               noble.stopScanning();
    if (heaterPeripheral)    heaterPeripheral.disconnect();
    writeChar  = null;
    notifyChar = null;
    app.debug('Plugin stopped');
  };

  return plugin;
};

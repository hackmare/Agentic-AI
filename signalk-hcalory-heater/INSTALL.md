# Installation on Raspberry Pi 4B

## 1. Copy plugin to SignalK

```bash
cd ~/.signalk/node_modules
cp -r /path/to/signalk-hcalory-heater .
cd signalk-hcalory-heater
npm install
```

## 2. Grant BLE permissions (avoids running as root)

```bash
sudo setcap cap_net_raw+eip $(eval readlink -f `which node`)
```

## 3. Enable in SignalK admin UI

- Open SignalK admin → **Plugin Config**
- Find **HCALORY Diesel Heater (BLE)**
- Set device name: `Heater5949`
- Set poll interval: `2` seconds
- Leave "Enable experimental write commands" **OFF** until monitoring is confirmed working
- Save & restart

## 4. Verify monitoring works

Watch the SignalK data browser for these paths:
- `propulsion.heater.state` → `running` / `cooldown` / `off`
- `propulsion.heater.mode` → `thermostat` / `gear` / `off`
- `propulsion.heater.voltage` → e.g. `13.2`
- `propulsion.heater.chamberTemperature` → ~493 K = 220°C when running
- `environment.inside.temperature` → room temp in Kelvin

## 5. Enable control (once monitoring confirmed)

- Turn ON "Enable experimental write commands" in plugin settings
- Use SignalK PUT requests to control:
  - `propulsion.heater.state` → `"on"` or `"off"`
  - `propulsion.heater.mode` → `"thermostat"` or `"gear"`
  - `propulsion.heater.tempUp` → any value (sends +1°C)
  - `propulsion.heater.tempDown` → any value (sends −1°C)

## Notes

- The write command format is **inferred** from a similar heater model — it needs physical testing to confirm.
- If the heater disconnects every ~30s without control commands working, the keepalive format may need adjustment. Check the plugin debug log for clues.
- The heater allows only one BLE connection at a time. Close the HCALORY app before connecting via SignalK.

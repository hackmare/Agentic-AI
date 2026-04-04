# Installation on Raspberry Pi 4B

## 1. Copy plugin to SignalK

```bash
cd ~/.signalk/node_modules
cp -r /path/to/signalk-ecowitt-gw2000 .
cd signalk-ecowitt-gw2000
npm install
```

## 2. Enable in SignalK admin UI

- Open SignalK admin → **Plugin Config**
- Find **Ecowitt GW2000B + WS90 Weather Station**
- Set **GW2000B IP address**: `192.168.0.35`
- Set **Port**: `80`
- Set **Poll interval**: `16` seconds (matches WS90 update rate)
- Save & restart

No configuration needed on the GW2000B — we poll it, it doesn't push to us.

## 3. Verify in SignalK data browser

You should see these paths updating:
- `environment.outside.temperature`
- `environment.outside.humidity`
- `environment.outside.dewPointTemperature`
- `environment.wind.directionTrue`
- `environment.wind.speedTrue`
- `environment.wind.gustSpeed`
- `environment.outside.solarRadiation`
- `environment.outside.uvIndex`
- `environment.outside.rainRate`
- `environment.outside.rainDayTotal`
- `environment.outside.pressure`
- `environment.outside.pressureSeaLevel`
- `environment.inside.temperature` (GW2000B internal sensor)
- `environment.inside.humidity`
- `electrical.batteries.ws90.voltage` (solar capacitor)
- `electrical.batteries.ws90backup.voltage` (AA battery)

## 4. Troubleshooting

If no data appears, check the SignalK server log for plugin debug output.
The plugin logs the raw response on first failure so you can verify field names.

You can also test the GW2000B API directly from the Pi:
```bash
curl http://192.168.0.35/get_livedata_info | python3 -m json.tool
```
This shows the exact JSON structure — compare field names against index.js if needed.

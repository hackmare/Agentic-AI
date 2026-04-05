# signalk-ecowitt-gw2000

A [Signal K](https://signalk.org) plugin for the **Ecowitt GW2000B** Wi-Fi gateway paired with a **WS90** all-in-one weather station.

Polls the GW2000B local HTTP API directly — no cloud account required, no push configuration needed on the gateway.

## Features

- Outdoor temperature, dew point, humidity
- Wind speed, direction, gust, and daily max gust
- Solar radiation and UV index
- Piezo rain rate and rain totals (event, hourly, daily, weekly, monthly, yearly)
- Barometric pressure (absolute and sea-level)
- Indoor temperature and humidity (GW2000B built-in sensor)
- WS90 solar capacitor and backup battery voltage

## Requirements

- Signal K server running on the same network as the GW2000B
- Ecowitt GW2000B with a **fixed IP address** on your local network
- WS90 all-in-one weather station connected to the GW2000B

## Installation

### From the Signal K AppStore

Open the Signal K admin UI → **Appstore**, search for `signalk-ecowitt-gw2000`, and click Install.

### Manual (Raspberry Pi)

```bash
cd ~/.signalk/node_modules
cp -r /path/to/signalk-ecowitt-gw2000 .
cd signalk-ecowitt-gw2000
npm install
```

Restart the Signal K server after installation.

## Configuration

Open Signal K admin → **Plugin Config** → **Ecowitt GW2000B + WS90 Weather Station**.

| Setting | Description | Default |
|---------|-------------|---------|
| GW2000B IP address | Fixed LAN IP of your gateway | `1.2.3.4` |
| HTTP port | Gateway web port (usually 80) | `80` |
| Poll interval (s) | How often to request data | `16` |
| Publish wind as true wind | True = true wind paths, False = apparent | `true` |

> **Tip:** You can assign a fixed IP to the GW2000B in your router's DHCP settings using its MAC address.

## Signal K Paths

| Path | Description | Unit |
|------|-------------|------|
| `environment.outside.temperature` | Outdoor temperature | K |
| `environment.outside.dewPointTemperature` | Dew point | K |
| `environment.outside.humidity` | Outdoor relative humidity | ratio (0–1) |
| `environment.wind.directionTrue` | Wind direction (true) | rad |
| `environment.wind.speedTrue` | Wind speed (true) | m/s |
| `environment.wind.gustSpeed` | Wind gust speed | m/s |
| `environment.wind.gustSpeedMaxDay` | Max daily gust | m/s |
| `environment.outside.solarRadiation` | Solar radiation | W/m² |
| `environment.outside.uvIndex` | UV index | — |
| `environment.outside.rainRate` | Rain rate | m/s |
| `environment.outside.rainEventTotal` | Rain event total | m |
| `environment.outside.rainHourTotal` | Hourly rain total | m |
| `environment.outside.rainDayTotal` | Daily rain total | m |
| `environment.outside.rainWeekTotal` | Weekly rain total | m |
| `environment.outside.rainMonthTotal` | Monthly rain total | m |
| `environment.outside.rainYearTotal` | Yearly rain total | m |
| `environment.outside.pressure` | Absolute barometric pressure | Pa |
| `environment.outside.pressureSeaLevel` | Sea-level barometric pressure | Pa |
| `environment.inside.temperature` | Indoor temperature (gateway sensor) | K |
| `environment.inside.humidity` | Indoor humidity (gateway sensor) | ratio (0–1) |
| `electrical.batteries.ws90.voltage` | WS90 solar capacitor voltage | V |
| `electrical.batteries.ws90backup.voltage` | WS90 backup battery voltage | V |

## Troubleshooting

**No data appearing:**

Test the GW2000B API directly from the Pi:
```bash
curl http://192.168.0.35/get_livedata_info | python3 -m json.tool
```
If this returns JSON, the network path is working. Check the Signal K server log for plugin error messages.

**Some paths missing:**

Not all fields are present on every firmware version. The plugin only publishes fields that are present and valid in the response — missing fields are silently skipped.

## License

MIT

# signalk-hcalory-heater

A [Signal K](https://signalk.org) plugin to monitor and control the **HCALORY TB2S** 8KW diesel parking heater via Bluetooth Low Energy (BLE).

The BLE protocol was reverse-engineered from nRF Connect logs (April 2026). Monitoring is confirmed working. Write commands (on/off, temperature, mode) are implemented but require physical testing to confirm.

## Features

- Heater state monitoring: off, pre-heat, self-test, igniting, running, cooling-down
- Operating mode: thermostat or gear
- Target temperature (thermostat mode) or gear level (gear mode)
- Chamber temperature and supply voltage
- **Experimental:** on/off control, temperature increment/decrement, mode switching via Signal K PUT requests

## Requirements

- Signal K server on a Raspberry Pi 4B (or other Linux host with Bluetooth)
- HCALORY TB2S diesel heater with Bluetooth enabled
- Node.js `@abandonware/noble` BLE library

## Tested Hardware

| Device | BLE Name | MAC |
|--------|----------|-----|
| HCALORY TB2S 8KW (ASIN B0F8HL7HZ2) | `Heater5949` | `20:25:05:19:00:E7` |

Other HCALORY Bluetooth heaters may work if they use the same `BD39/BDF7/BDF8` UUID set — see [BLE Protocol](#ble-protocol) below.

## Installation

### Manual (Raspberry Pi)

```bash
cd ~/.signalk/node_modules
cp -r /path/to/signalk-hcalory-heater .
cd signalk-hcalory-heater
npm install

# Grant BLE access without running as root:
sudo setcap cap_net_raw+eip $(eval readlink -f `which node`)
```

Restart the Signal K server after installation.

## Configuration

Open Signal K admin → **Plugin Config** → **HCALORY Diesel Heater (BLE)**.

| Setting | Description | Default |
|---------|-------------|---------|
| Heater BLE device name | Name shown in your BLE scanner | `Heater5949` |
| Poll / keepalive interval (s) | How often to send a keepalive to the heater | `2` |
| Enable experimental write commands | Enables PUT-based control | `false` |

> **Recommended:** Enable monitoring first and confirm data is correct before turning on write commands.

## Signal K Paths

### Monitored (read)

| Path | Description | Unit |
|------|-------------|------|
| `propulsion.heater.state` | Heater state: `off`, `pre-heat`, `self-test`, `igniting`, `running`, `cooling-down`, `transitioning`, `error` | string |
| `propulsion.heater.mode` | Operating mode: `off`, `thermostat`, `gear`, `startup` | string |
| `propulsion.heater.targetTemperature` | Target temperature (thermostat mode only) | K |
| `propulsion.heater.gearLevel` | Gear level 1–10 (gear mode only) | — |
| `propulsion.heater.voltage` | Supply voltage | V |
| `propulsion.heater.voltageSecondary` | Secondary voltage reading | V |
| `propulsion.heater.chamberTemperature` | Combustion chamber temperature | K |

### Controllable (PUT) — experimental

| Path | Value | Action |
|------|-------|--------|
| `propulsion.heater.state` | `"on"` / `"off"` | Start or stop the heater |
| `propulsion.heater.mode` | `"thermostat"` / `"gear"` | Switch operating mode |
| `propulsion.heater.tempUp` | any | Increase target temp / gear by 1 step |
| `propulsion.heater.tempDown` | any | Decrease target temp / gear by 1 step |

> **Note:** The heater only supports 1-step increments — absolute temperature setting is not possible via BLE.

## BLE Protocol

The TB2S uses a proprietary Nippon Seiki BLE module, **not** the common AA55 or MVP protocol used by other Ecowitt-compatible heaters.

| | UUID |
|--|------|
| Service | `0000BD39-0000-1000-8000-00805F9B34FB` |
| Write characteristic | `0000BDF7-0000-1000-8000-00805F9B34FB` |
| Notify characteristic | `0000BDF8-0000-1000-8000-00805F9B34FB` |

Status packets are 43 bytes. Key bytes in the notify payload:

| Byte | Meaning |
|------|---------|
| `[15]` | Supply voltage × 10 |
| `[20]` | Heater state (see below) |
| `[21]` | Mode: `0x00`=off, `0x01`=thermostat, `0x02`=gear, `0x03`=startup |
| `[22]` | Thermostat: target °C — Gear: gear level 1–10 |
| `[25]` | Secondary voltage × 10 |
| `[27–28]` | Chamber temp big-endian ÷ 10 = °C |
| `[42]` | Checksum: `sum(bytes[8..41]) mod 256` |

**State codes (byte `[20]`):**

| Code | State |
|------|-------|
| `0x00` | off |
| `0x01` | transitioning |
| `0xC1` | pre-heat (glow plug) |
| `0x80`, `0x81` | self-test |
| `0x83` | igniting |
| `0x85` | running |
| `0x43–0x45` | cooling-down |
| `0xFF` | error |

## Troubleshooting

**Heater not found during scan:**
- Make sure the HCALORY app is closed — the heater only accepts one BLE connection at a time.
- Check the device name matches exactly (case-sensitive) in plugin settings.

**Error 133 / GATT error on connect:**
- Toggle Bluetooth off and on on the Pi: `sudo hciconfig hci0 down && sudo hciconfig hci0 up`
- Ensure `cap_net_raw` capability is set on the Node.js binary (see Installation).

**Write commands have no effect:**
- Write commands are experimental and based on a similar heater model. They need physical validation.
- Check the plugin debug log for write errors.

## License

MIT

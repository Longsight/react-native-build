# react-native-build
### Build scripts for React Native apps
This repo contains a configurable build script for React Native apps, which performs the following:
- Clones the current source repo to a temporary build directory
- Checks out the selected branch (defaults to `master`)
- Bootstraps the build with node_modules, Ruby gems, Cocapods, other template files etc
- Writes properties.[platform].json and .env.json files, based on `config.json` and arguments
- Calls the specified Fastlane action to build and publish the app
- Cleans up after itself

### Installation
- Install NodeJS / Ruby / Android or iOS SDK (as applicable)
- `$ npm i`

### Run
```
$ ./build.js
  [--branch <branch>]
  [--lane <lane>]
  [--config <config file>]
  [--quiet | --no-quiet]
  [--release | --no-release]
  [--live | --no-live]
  [--cleanup | --no-cleanup]
  [--increment | --no-increment]

Running on Darwin (OSX):
  [--android]
```

### Configuration
#### `config.json` file
| Property | Type | Purpose | Default | Possible values |
| -------- | ---- | ------- | ------- | --------------- |
| repo | `string` | Source repository (Github username/repository format) | user/example-repo | *any valid Github repo* |
| prefix | `string` | Folder prefix for temporary working dir (arbitrary) | example-app | *anything* |
| github | `object` | Github vars | `{credentials: null}` | `{credentials: {user: 'username', password: 'password'}}` |
| fastlane | `object` | Fastlane vars | `{credentials: null}` | `{credentials: {user: 'username', password: 'password'}}` |
| srcDir | `string` | Working directory path | src | *any valid folder in the repo* |
| versionCounter | `url` | URL to remote version counter | https://example.com/counter/ | *Valid link to remote build counter* |
| env | `object` | Environment settings to write to .env.json | `{}` | *any valid `env` object* |

#### Build arguments
| Argument | Type | Purpose | Default | Possible values |
| -------- | ---- | ------- | ------- | --------------- |
| `--branch` | `string` | Git branch to checkout | master | pm-master, etc |
| `--lane` | `string` | Fastlane lane to run | qa | qa, release, dryrun |
| `--config` | `string` | Config file to read | ./config | `any` |
| `--quiet` | `boolean` | Don't show external build output | `false` | `false`, `true` |
| `--release` | `boolean` | Build a production release (forces `--lane release` and `--live`) | `false` | `false`, `true` |
| `--live` | `boolean` | Point to live environment rather than development | `false` | `false`, `true` |
| `--cleanup` | `boolean` | Clean up working dirs after build | `true` | `true`, `false` |
| `--increment` | `boolean` | Increment build number | `true` | `true`, `false` |
| `--android` | `boolean` | Build for Android rather than iOS when running on Darwin | `false` | `false`, `true` |

### Notes
- Config is read from a config file in JSON format, which is sourced from the following locations in order:
  - `argv.config + '.' + argv.lane + '.json'`
  - `argv.config + '.json'`
- "Version counter" refers to a URL that immediately returns an integer build number, which should (by default) increment on each access, to provide a centralised method to ensure incremental version numbers.
- Boolean arguments can be negated with `--no-`, eg. `--no-cleanup` is equivalent to `--cleanup false`.
- In quiet mode, build output is logged to `[workingDir]/build.log`. Root working dir will not be removed if output logging is enabled in this way, to preserve log file.
- Default clone method is SSH with agent - if this fails, the script will fall back to HTTPS username / password auth using credentials supplied in `config.json`.
- Using either `--lane release` or `--release` will force the other, so as to avoid release builds that accidentally point at staging or dev etc.

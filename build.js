#!/usr/bin/env node

var fs = require('fs');
var os = require('os');
var darwin = os.platform() === 'darwin';

var path = require('path');
var child_process = require('child_process');
var chalk = require('chalk');
var uncolor = require('uncolor');
var pluralize = require('pluralize');
var git = require('nodegit');
var fetch = require('node-fetch');
var fs = require('fs-extra');
var jsonfile = require('jsonfile');
var argv = require('minimist')(process.argv, {
  string: ['branch', 'lane', 'config'],
  boolean: ['android', 'quiet', 'cleanup', 'release', 'live', 'increment', 'help'],
  default: {
    branch: 'master',
    lane: 'qa',
    config: './config',
    android: darwin? false: true,
    quiet: false,
    release: false,
    live: false,
    cleanup: true,
    increment: true,
    help: false
  }
});

var workingDir, buildNumber, config;
var cwd = process.cwd();
var warnings = 0;
var errors = 0;
var httpsAttempt = false;
var logging = false;

var gitOpts = function(ssh) {
  return {
    fetchOpts: {
      callbacks: {
        certificateCheck: function() { return 1; },
        credentials: function(url, userName) {
          if (ssh) {
            return git.Cred.sshKeyFromAgent(userName);
          } else {
            if (!config.github.credentials || !config.github.credentials.user || !config.github.credentials.password) {
              error('Cannot use HTTPS auth without user and password');
            }
            if (httpsAttempt) {
              error('Failed to authenticate with provided credentials');
            }
            httpsAttempt = true;
            return git.Cred.userpassPlaintextNew(config.github.user, config.github.password);
          }
        }
      }
    },
  }
};

var hr = function(func) {
  return function(...args) {
    var lineWidth = (process.stdout.columns - func.name.length - 2) / 2;
    console.log();
    console.log(
      chalk.cyan('='.repeat(Math.ceil(lineWidth))) + ' ' +
      chalk.bold.green(func.name.toUpperCase()) +
      chalk.cyan(' ' + '='.repeat(Math.floor(lineWidth)))
    );
    console.log();
    return func.apply(null, args);
  }
};

var prefixStream = function(prefix, data) {
  return prefix + ' ' + `${data}`.trim()
    .split(/\n/).map((line) => {
      var splits = line.match(new RegExp(`.{1,${process.stdout.columns - 11}}(?=\\S\\s|\\s\\S|$)`, 'g'))
      if (!splits) {
        return null;
      }
      return splits.join('\n' + prefix + '   ');
    }).filter((item) => item !== null)
    .join('\n' + prefix + ' ') + '\n';
};

var exec = function(cmd, callback, env = {}) {
  return child_process.exec(cmd, {
    shell: '/bin/bash',
    env: Object.assign({}, process.env, env)
  }, callback);
};

var spawn = function(cmd, args, prefix = chalk.magenta.inverse(' EXTERN '), env = {}) {
  var out;
  var proc = child_process.spawn(cmd, args, {
    shell: '/bin/bash',
    env: Object.assign({}, process.env, env)
  });
  if (!argv.quiet) {
    out = function(prefix, data) {
      process.stdout.write(prefixStream(prefix, data));
    }
  } else {
    var logStream = fs.createWriteStream(workingDir + '/build.log');
    logging = true;
    out = function(prefix, data) {
      logStream.write(uncolor(data));
    }
    proc.on('end', function() {
      logStream.end();
    });
  }
  proc.stderr.on('data', function(data) {
    out(chalk.red.inverse(' ERROR! '), data);
  });
  proc.stdout.on('data', function(data) {
    out(prefix, data);
  });
  return proc;
};

var finish = function(abort = false) {
  process.chdir(cwd);
  if (argv.quiet) {
    info(`Build output logged to ${workingDir}/build.log`);
  }
  if (workingDir && argv.cleanup) {
    var removeDir;
    info(chalk.bold('Cleaning up...'));
    if (!argv.quiet) {
      removeDir = workingDir;
      info(`Removing temporary working directory ${chalk.bold(removeDir)}`);
    } else {
      removeDir = workingDir + '/' + config.srcDir;
      info(`Removing source directory ${chalk.bold(removeDir)}`);
    }
    fs.removeSync(removeDir);
  }
  hr(summary)(abort);
};

var summary = function(abort) {
  var count = warnings + errors;
  if (count > 0) {
    if (abort) {
      error(chalk.bold('Build aborted, with errors:'), false);
      errors--;
    } else {
      warn(chalk.bold('Build finished, with issues:'));
      warnings--;
    }
    if (warnings > 0) {
      warn(warnings + ' ' + pluralize('warning', warnings));
    }
    if (errors > 0) {
      error(errors + ' ' + pluralize('error', errors), false);
    }
  } else {
    info(chalk.bold('Build finished without issues'));
  }
  if (logging) {
    info(`External build log at ${workingDir}/build.log`);
  }
  console.log();
  process.exit(count);
}

var info = function(message) {
  console.log(chalk.cyan.inverse('  INFO  ') + chalk.cyan(' %s'), message);
}

var warn = function(message) {
  warnings++;
  console.log(chalk.yellow.inverse('  WARN  ') + chalk.yellow(' %s'), message);
}

var error = function(message, fatal = true) {
  errors++;
  console.log(chalk.red.inverse(' ERROR! ') + chalk.red(' %s'), message);
  if (fatal) {
    hr(finish)(true);
  }
}

var init = function() {
  if (!darwin) {
    if (!argv.android) {
      warn(`${chalk.bold('--android false')} is invalid on non-Darwin architectures
             Defaulting to ${chalk.bold('--android true')}`);
      console.log()
    }
    argv.android = true;
  }

  if (argv.release || argv.lane === 'release') {
    argv.live = true;
    argv.release = true;
    argv.lane = 'release';
  }

  info(`Detected build platform: ${chalk.bold(os.platform())}`);
  info(`Building for: ${chalk.bold(argv.android? chalk.green('Android'): chalk.red('iOS'))}`);
  console.log();

  info('Using arguments:');
  console.log(Object.keys(argv).filter(function(k) {
    return k !== '_';
  }).map(function(k) {
    return `           --${k}:${' '. repeat(10 - k.length)}${chalk.blue.bold(argv[k])}`;
  }).join(`\n`));
  console.log();

  try {
    try {
      var configFile = `${argv.config}.${argv.lane}.json`;
      info(`Loading config from ${configFile}...`);
      config = require(configFile);
    } catch (e) {
      configFile = `${argv.config}.json`;
      config = require(configFile);
      info(`Failed to load lane-specific config file, falling back to ${configFile}`);
    }
  } catch (e) {
    error('Could not open ' + configFile);
  }

  buildNumber = fetch(config.versionCounter + (!argv.increment? '?no-increment': '')).then(function(res) {
    if (res.ok) {
      return res.json();
    } else {
      error('Failed to fetch next version number');
    }
  });

  var buildRootDir = [os.tmpdir(), 'rn-build', config.prefix, ''].join(path.sep);
  return new Promise(function(resolve, reject) {
    fs.ensureDir(buildRootDir, function(err, made) {
      if (err) {
        reject(err);
      } else {
        resolve(made);
      }
    });
  }).catch(function(err) {
    error(`Could not create root build directory ${chalk.bold(buildRootDir)}`);
  }).then(function() {
    return new Promise(function(resolve, reject) {
      fs.mkdtemp(buildRootDir, function(err, dir) {
        if (err) {
          reject(err);
        } else {
          resolve(dir);
        }
      });
    });
  }).catch(function(err) {
    error(`Could not create build directory in ${chalk.bold(buildRootDir)}`);
  });
}

var clone = function(buildDir, ssh = true) {
  var prefix = (ssh? 'git@github.com:': 'https://github.com/');
  workingDir = buildDir;
  info(`Cloning repository ${chalk.bold(config.repo)} into ${chalk.bold(buildDir)}`);
  return git.Clone(prefix + config.repo, buildDir, gitOpts(ssh)).catch(function(err) {
    if (ssh && err.message.includes('SSH')) {
      warn('SSH clone failed, falling back to HTTPS');
      return clone(buildDir, false);
    } else {
      error('Could not clone repository ' + config.repo);
    }
  });
};

var checkout = function(repo) {
  info(`Checking out branch ${chalk.bold(argv.branch)}`);
  return repo.getBranch('refs/remotes/origin/' + argv.branch).then(function(ref) {
    return repo.checkoutRef(ref);
  }).then(function() {
    return repo;
  }).catch(function(err) {
    if (argv.branch !== 'master') {
      warn(`Failed to checkout branch ${chalk.bold(argv.branch)} , falling back to master`);
      argv.branch = 'master';
      return checkout(repo);
    } else {
      error('Failed to checkout master branch');
    }
  });
};

var bootstrap = function(repo) {
  try {
    var workdir = repo.workdir() + config.srcDir;
    process.chdir(workdir);
  } catch (e) {
    error('Failed to change working directory to ' + chalk.bold(workdir));
  }
  info('Working directory changed to ' + chalk.bold(workdir));
  return new Promise(function(resolve, reject) {
    info('Installing node modules');
    exec('npm i', function(err, stdout, stderr) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  }).catch(function(err) {
    error('Failed to install node modules; check npm-debug.log for more information');
  }).then(function() {
    return new Promise(function(resolve, reject) {
      info('Updating fastlane');
      exec('bundle update fastlane', function(err, stdout, stderr) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }).catch(function(err) {
    error('Failed to run bundle install');
  }).then(function() {
    var package = require(`${workdir}/package.json`);
    var buildType = argv.live? 'release': 'development';
    return Promise.all([package.version, buildType, buildNumber]);
  }).then(function(properties) {
    var props = {
      version: properties[0],
      buildType: properties[1],
      build: properties[2],
    }
    info(`Writing properties files with: ${JSON.stringify(props)}`);
    return Promise.all([
      new Promise(function(resolve, reject) {
        jsonfile.writeFile('./properties.android.json', props, function(err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      }),
      new Promise(function(resolve, reject) {
        jsonfile.writeFile('./properties.ios.json', props, function(err) {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      }),
    ]);
  }).catch(function(err) {
    error('Failed to write properties file');
  }).then(function() {
    info(`Writing .env.json file with: ${JSON.stringify(config.env)}`);
    return new Promise(function(resolve, reject) {
      jsonfile.writeFile('./js/.env.json', config.env, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }).catch(function(err) {
    error('Failed to write .env.json file');
  }).then(function() {
    info('Copying template files');
    return new Promise(function(resolve, reject) {
      var templateSrc = cwd + '/templates';
      fs.copy(templateSrc, workdir, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }).catch(function(err) {
    error('Failed to copy template files');
  });
};

var build = function() {
  return new Promise(function(resolve, reject) {
    var platform = argv.android? 'Android': 'iOS';
    var env = config.fastlane.credentials? {
      FASTLANE_USER: config.fastlane.credentials.user,
      FASTLANE_PASSWORD: config.fastlane.credentials.password,
    }: {};
    info(`Handing off to ${chalk.bold('fastlane')} to build ${chalk.bold(argv.lane)} for ${chalk.bold(platform)}`);
    var buildProc = spawn('bundle', ['exec', 'fastlane', platform.toLowerCase(), argv.lane], chalk.green.inverse(' BUILD! '), env);
    buildProc.on('close', function(code) {
      if (code > 0) {
        error('Build failed, see output for details');
        reject();
      } else {
        info('Build exited normally');
        resolve();
      }
    });
  });
};


// Main sync
process.on('SIGINT', function() {
  console.log();
  error('Aborted on SIGINT');
});

if (argv.help || !argv.branch || !argv.lane) {
  console.log(`${chalk.bold('TSR React Native build platform')}
Usage: ./build.js                   Purpose             Default
  [--branch <${chalk.bold('branch')}>]                 Git branch          ${chalk.cyan.bold('\'master\'')}
  [--lane <${chalk.bold('lane')}>]                     Fastlane lane       ${chalk.cyan.bold('\'qa\'')}
  [--config <${chalk.bold('config file')}>]            Config file         ${chalk.cyan.bold('\'./config.json\'')}
  [--quiet | --no-quiet]              Quiet output        ${chalk.red.bold('false')}
  [--release | --no-release]          Release build       ${chalk.red.bold('false')}
  [--live | --no-live]                Live environment    ${chalk.red.bold('false')}
  [--cleanup | --no-cleanup]          Cleanup after       ${chalk.green.bold('true')}
  [--increment | --no-increment]      Increment build #   ${chalk.green.bold('true')}

Running on ${chalk.bold('Darwin (OSX)')}:
  [--android]                         Build for Android   ${chalk.red.bold('false')}

See README.md for more info`);
  process.exit(0);
}

// Main loop
hr(init)()
  .then(hr(clone))
  .then(hr(checkout))
  .then(hr(bootstrap))
  .then(hr(build))
  .then(hr(finish));

const path = require('path')
const fs = require('fs')
const YAML = require('js-yaml')
const JSON5 = require('json5')
const HJSON = require('hjson')
const flatten = require('flat')
const unflatten = require('flat').unflatten
const EventEmitter = require('events')
const os = require('os')
const dotProperties = require('dot-prop-opt')
const listdir = require('./helpers/listdir')

/**
 * distributed-config
 *
 * Search for config files by naming convention
 * filename convention:
 * <name>.<environment>.<config>.<extension>
 *
 * Environments:
 *   - default => naming needed!!
 *   - development
 *   - test
 *   - production
 *   - local (is not a environment and must no be commited!)
 *   - env (environment-overrides)
 *
 * Loading rules:
 *   default -> <enviroment> -> local -> environment-overrides
 *
 * Questions:
 * - Should we return an instance on set or boolean?
 * - Should we prove arguments and return error or return an boolean?
 *
 * @class DistConf
 */
class DistConf extends EventEmitter {
  /**
   * @constructor
   * @param {object} [options?] - Description
   * @returns {instance}
   */
  constructor (options) {
    super()

    this.options = {
      env: process.env.NODE_ENV || 'development',
      hostname: process.env.HOST || process.env.HOSTNAME,
      config_dirs: process.cwd(),
      ignored_config_dirs: ['node_modules', 'coverage', 'test', 'tests', '__test__', '__tests__'],
      config_file_pattern: '.config(?=.(json||hjson||json5||yaml|yml|js)$)'
    }
    this.ENV_LIST = ['default']
    this.CONFIG_SOURCES = []

    Object.assign(this.options, options)
    this.clean()
    this.setConfigDirs(this.options.config_dirs)
    this.setEnvironment(this.options.env)
    this.setHostname(this.options.hostname)

    return this
  }

  /**
   * Set values on data store
   *
   * @method set
   * @param {string} key - The key inside the object configuration. Nested key have to be separated by a dot. ('key1.subkey.subsubkey')
   * @param {*} value - The value can be a string, boolean, number or a object.
   * @returns {this} - Instance of class
   */
  set (key, value) {
    if (typeof key !== 'string') {
      throw new TypeError(`Expected \`key\` to be of type \`string\`, got ${typeof key}`)
    }

    if (typeof key === 'string' && typeof value === 'undefined') {
      throw new TypeError('Use `delete()` to clear values')
    }

    return dotProperties.set(this._store, key, value)
  }

  /**
   * Check if the requested property exists.
   *
   * @method has
   * @param {string} key - Description
   * @return {boolean}
   */
  has (key) {
    if (typeof key !== 'string') {
      throw new TypeError(`Expected \`key\` to be of type \`string\`, got ${typeof key}`)
    }

    return dotProperties.has(this._store, key)
  }

  /**
   * Read propertie value / values from data store.
   * To get nested property, join the properties to one string separated with a dot.
   *
   * @method get
   * @param {string} key - The key is a string of concated object propties by a dot
   * @param {default} default - Default return value when property do not exists
   * @returns {*} - The key value or undefined when key was not found.
   */
  get (key, defaultValue) {
    // Argument validation
    if (typeof key !== 'string') {
      throw new Error('Key argument is required and should be a string.')
    }

    return dotProperties.get(this._store, key, defaultValue)
  }

  /**
   * Clean the internal data store by override with blank object.
   *
   * @method clean
   * @returns {this}
   */
  clean () {
    this._store = Object.create(Object.prototype)
    return this
  }

  /**
   * Return the complete data store object.
   *
   * @method store
   * @returns {object} - Complete data store object.
   */
  store () {
    return this._store
  }

  /**
   * Load all config files from given path.
   * The call to load config files reset automatically the previous loaded configuration.
   *
   * @method load
   * @param {array|string} paths - Description
   * @returns {this}
   */
  load (paths) {
    if (paths) this.setConfigDirs(paths)
    // in case of error restore the previous datastore.
    // JSON parse make the fastest deep clone
    const _backupDataStore = JSON.parse(JSON.stringify(this._store))

    try {
      this._store = {}
      this.CONFIG_SOURCES = []
      this.getConfigDirs().forEach(configPath => {
        this.CONFIG_SOURCES = this.CONFIG_SOURCES.concat(listdir.parsedirSync(configPath, this.options.config_file_pattern, this.options.ignored_config_dirs))
      })
      Object.assign(this._store, this._importConfigFilesToDataStore())
      this.emit('loaded')
    } catch (error) {
      this._store = JSON.parse(JSON.stringify(_backupDataStore))
      this.emit('error', error)
    }

    return this
  }

  /**
   * Return the sources for the configurations
   *
   * @description
   * All sources for configurations are stored in an array containing
   * the absolute path and filename.
   *
   * @method getConfigSources
   * @returns {Array} - Array of all used config files including path.
   */
  getConfigSources () {
    return this.CONFIG_SOURCES.slice(0)
  };

  /**
   * Return the detected or manualy set environment
   *
   * @method getEnvironment
   * @returns {string} - Environment name
   */
  getEnvironment () {
    return this.ENVIRONMENT
  }

  /**
   * Set the environment manualy. Thos overrides the NODE_ENV set environment.
   *
   * @method setEnvironment
   * @param {string} environment - Description
   * @returns {this}
   */
  setEnvironment (env) {
    if (typeof env !== 'string') {
      throw new Error('Enviroment argument is required and should be a string.')
    }

    this.ENVIRONMENT = env
    this._buildEnvironmentList()

    return this
  }

  /**
   * Return array of actually set config directories.
   *
   * @method getConfigDirs
   * @returns {array} - Array of paths
   */
  getConfigDirs () {
    return this.BASE_DIRS.slice(0)
  }

  /**
   * Set config directories where to search for config files.
   *
   * @method setConfigDirs
   * @param {array|string} dirs - Array of paths
   * @returns {this}
   */
  setConfigDirs (dirs) {
    if (typeof dirs === 'string') dirs = Array.of(dirs)
    if (dirs instanceof Array === false) {
      throw new Error(`Method require 'dirs' argument as array of strings!`)
    }

    this.BASE_DIRS = dirs
    return this
  }

  /**
   * Set the hostname by argument or automaticaly when no argument is given.
   *
   * @method setHostname
   * @param {string} hostname - Description
   * @returns {this}
   */
  setHostname (hostname) {
    if (typeof hostname !== 'string' && typeof hostname !== 'undefined') {
      throw new Error(`Hostname argument should be a string!`)
    }

    if (typeof hostname === 'string') {
      this.HOSTNAME = hostname
      return this
    }

    try {
      this.HOSTNAME = os.hostname()
    } catch (error) {
      this.HOSTNAME = 'localhost'
    }

    return this
  }

  /**
   * Return the current set hostname.
   *
   * @method getHostname
   * @returns {string} - The resolved hostname
   */
  getHostname () {
    return this.HOSTNAME
  }

  /**
   *
   * @method importFile
   * @param {string} file - Description
   * @param {string} dir - Description
   * @param {*} namespace - Description
   * @returns {this}
   */
  importFile (file, dir, namespace) {
    if (typeof file !== 'string') {
      throw new Error('File argument is required and should be a string.')
    }

    if (typeof namespace !== 'string' && typeof namespace !== 'undefined') {
      throw new Error('Namespace argument should be a string.')
    }

    if (typeof dir !== 'string') {
      dir = process.cwd()
    }

    const fileContent = this._importFiles(listdir.parsedirSync(dir, file))

    if (namespace) {
      this.set(namespace, fileContent)
      return this
    }

    Object.assign(this._store, fileContent)

    return this
  }

  /**
   * Filter in files array for files which correspond
   * to requested environemnt depend on naming convention.
   *
   * File name convention:
   * <name>.<environment>.<config>.<extension>
   *
   * @private
   * @method _filterFilesByEnvironment
   * @param {array} files
   * @param {string} environment
   * @returns {array} Array of files that match requested environment
   */
  _filterFilesByEnvironment (files, environment) {
    const regex = new RegExp(`.${environment}.`, 'i')
    return files.filter((file) => regex.test(file))
  }

  /**
   * Import files of the array.
   * @todo lint json result
   *
   * @private
   * @method _importFiles
   * @param {array} files
   * @returns {object} Parsed file content
   */
  _importFiles (files) {
    let fileContent = {}

    files.forEach((file) => {
      switch (path.extname(file).toLowerCase().substring(1)) {
        case 'js':
          Object.assign(fileContent, require(file))
          break
        case 'yml':
        case 'yaml':
          Object.assign(fileContent, YAML.safeLoad(fs.readFileSync(file, 'utf8')))
          break
        case 'json':
          Object.assign(fileContent, require(file))
          break
        case 'json5':
          Object.assign(fileContent, JSON5.parse(fs.readFileSync(file, 'utf8')))
          break
        case 'hjson':
          Object.assign(fileContent, HJSON.parse(fs.readFileSync(file, 'utf8')))
          break
      }
    })

    return fileContent
  }

  /**
   * Import config files from environment list
   *
   * @private
   * @method _importConfigFilesToDataStore
   * @returns {object} - Merged configuration from all config files
   */
  _importConfigFilesToDataStore () {
    const store = Object.create(Object.prototype)

    this.ENV_LIST.forEach((env) => {
      let fileContent = this._importFiles(this._filterFilesByEnvironment(this.CONFIG_SOURCES, env))

      // On customs vars map environment variables into the configuration
      if (env === 'env' && Object.keys(fileContent).length) {
        fileContent = this._getCustomEnvironmentVariables(fileContent)
      }

      // Merge to data store
      Object.assign(store, fileContent)
    })

    return store
  }

  /**
   * Map environment variables into the configuration
   *
   * @private
   * @method _getCustomEnvironmentVariables
   * @param {object} data
   * @returns {object}
   */
  _getCustomEnvironmentVariables (data) {
    let _flatData = flatten(data)
    Object.keys(_flatData).forEach(KEY => {
      if (process.env[_flatData[KEY]]) {
        _flatData[KEY] = process.env[_flatData[KEY]]
      } else {
        delete _flatData[KEY]
      }
    })
    return unflatten(_flatData)
  }

  /**
   * Helper method to build the environment list from one place.
   *
   * @private
   * @method _buildEnvironmentList
   * @returns {void}
   */
  _buildEnvironmentList () {
    this.ENV_LIST = ['default', this.ENVIRONMENT, 'local', 'env']
    if (this.HOSTNAME) {
      this.ENV_LIST.splice(2, 0, this.HOSTNAME)
    }
  }
}

module.exports = DistConf

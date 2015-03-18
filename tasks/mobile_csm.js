/*
 * grunt-mobile-csm
 *
 *
 * Copyright (c) 2015 Kapil Kumawat
 * Licensed under the MIT license.
 */

'use strict';

module.exports = function (grunt) {

  // Please see the Grunt documentation for more information regarding task
  // creation: http://gruntjs.com/creating-tasks

  grunt.registerMultiTask('mobile_csm', 'CSM mobile file minifier and sencha mobile app', function () {

    // Merge task-specific and/or target-specific options with these defaults.
    var opts = this.options(),
        path = require('path'),
        array = require('array-extended'),
        fileCounter = 0,
        options,
        initPromise,
        DOT_JS_RX = /\.js$/,
        localeFiles = [],
        resolveFromJsonFiles = [],
        parser,
        graph = require('./graph').init(grunt),
        Promise = require('promise'),
        tmp = require('tmp'),
        uglify = require('uglify-js'),
        tmpdirp = Promise.denodeify(tmp.dir);
    grunt.log.writeln('Adding ' + opts.src.length + ' directories to classpath...');

    function readOptions() {
      var options = opts || {},
        rootDir = options.rootDir || process.cwd();

      return {
        includeFilePattern: options.includeFilePattern || /\.js$/,
        excludeFiles: options.excludeFiles,

        skipParse: options.skipParse,

        rootDir: rootDir,

        excludeClasses: options.excludeClasses || ['Ext.*','CAMobile.*', 'CAMobileMain.*'],

        uglify: options.uglify || true,

        loadLocaleFiles: options.loadLocaleFiles || false,

        tempDir: (options.tempDir ? path.resolve(process.cwd(), options.tempDir) : null)
      };
    }
    options = readOptions();
    parser = require('./parser.js').init(grunt, options);

    if (!options.tempDir) {
      initPromise = tmpdirp({
        mode: '0777',
        prefix: 'mobile_csm_',
        unsafeCleanup: true
      }).then(function (path) {
        grunt.verbose.ok('Done, ' + path);
        options.tempDir = path;
        return exports;
      }, function (reason) {
        grunt.fail.warn(reason);
      });
    } else {
      initPromise = new Promise(function (done, fail) {
        try {
          grunt.file.mkdir(options.tempDir);
          grunt.verbose.ok('Done, ' + options.tempDir);
          done(exports);
        } catch (e) {
          fail(e);
          grunt.fail.warn(e);
        }
      });
    }

    function addDir (dirs, parse) {
      if (!Array.isArray(dirs)) {
        dirs = [{ path: dirs, parse: parse !== false }];
      }

      dirs.forEach(function (dir) {
        var dirPath, parse;

        if (typeof dir === 'string') {
          dirPath = dir.charAt(0) === '/' ? dir : path.join(opts.rootDir, dir);
          parse = true;
        } else {
          dirPath = dir.path.charAt(0) === '/' ? dir.path : path.join(opts.rootDir, dir.path);
          parse = dir.parse !== false;
        }

        grunt.verbose.writeln('Adding dir ' + dirPath);

        readDir(dirPath, parse);
      });

      return fileCounter;
    }

    function getOutputPath(filePath) {
      return path.join(options.tempDir, path.relative(options.rootDir, filePath));
    }

    function shouldProcessFile(filePath) {
      var p = true;
      if (options.includeFilePattern) {
        p = options.includeFilePattern.test(filePath);
      }
      return p;
    }

    function readDir(dirPath, parse) {
      grunt.file.recurse(dirPath, function (abspath) {
        if ( shouldProcessFile(abspath) ) {
          grunt.verbose.writeln('Reading file dir ' + abspath);
          readFile(abspath, parse);
        }
      });
    }

    function readFile(filePath, parse) {
      var outputPath = getOutputPath(filePath),
        data, node,result;
      grunt.verbose.writeln('Output file dir ' + outputPath);
      if((outputPath.indexOf("locale_") > -1 && outputPath.indexOf("locale_en_US") === -1) || (outputPath.indexOf("settings.js") > -1) || (outputPath.indexOf("app_languages.js") > -1) || (outputPath.indexOf(opts.outputFilename + ".js") > -1) || (outputPath.indexOf(opts.outputFilename + "-tablet.js") > -1)) {
        return;
      }
      if (parse) {
        data = grunt.file.read(filePath, { encoding: 'utf-8' });
        if (data && (node = parser.parse(data, outputPath))) {
          graph.addNode(node);
          grunt.file.write(outputPath, node.src, { encoding: 'utf-8' });
        }
      } else {
        graph.addNode(parser.getClass(outputPath));
        grunt.file.copy(filePath, outputPath, { encoding: 'utf-8' });
      }
      if(options.uglify) {
        result = uglify.minify(outputPath, {});
        grunt.file.write(outputPath, result.code);

      }
      if(outputPath.indexOf("locale_en_US") > -1) {
        if(options.loadLocaleFiles) {
          localeFiles.push(outputPath);
        }
      }
      fileCounter++;
    }

    addDir(opts.src);
    function resolveDependencies (from, isTablet) {
      var resolveFrom = (Array.isArray(from) ? from : [from]).map(function (name) {
          if (~(name || '').indexOf(path.sep) || DOT_JS_RX.test(name)) {
            return name;
          } else {
            return name;
          }
        }),
        required = graph.getDependencies(from, isTablet);

      return {
        required: required,
        diff: array.difference(graph.getAllNodePaths(), required)
      };
    }
    grunt.log.writeln('Now start resolve files');
    if(!opts.resolveFrom) {
      opts.resolveFrom = [];
    }

    if(options.loadLocaleFiles) {
      opts.resolveFrom = localeFiles.concat(opts.resolveFrom);
    }

    if(opts.resolveFromJson) {
      var resolveFile, readObject, resultsArray;
      opts.resolveFromJson.forEach(function(file) {
        resolveFile = file.charAt(0) === '/' ? file : path.join(opts.rootDir, file);
        readObject = JSON.parse(grunt.file.read(resolveFile));
        if(readObject && readObject.d && readObject.d.results) {
          resultsArray = readObject.d.results;
          resultsArray.forEach(function(resultArray) {
            Object.keys(resultArray).map(function(value, index) {
              if(value.indexOf("controller") > -1 || value.indexOf("tourClass") > -1 || value.indexOf("mainClass") > -1 || value.indexOf("searchClass") > -1 || value.indexOf("tileClass") > -1) {
                resolveFromJsonFiles.push(resultArray[value]);
              }
            });
          });
        }
      });
    }
    if(resolveFromJsonFiles.length > 0) {
      opts.resolveFrom = opts.resolveFrom.concat(resolveFromJsonFiles);
    }

    var deps = resolveDependencies(opts.resolveFrom), required, diff;
    required = deps.required;
    diff = deps.diff;
    grunt.log.ok('Done, dependency graph has ' + required.length + ' files.');

    grunt.log.writeln('----------------- Required files -----------------');
    grunt.log.writeln(required.join("\n"));

    if (diff && diff.length) {
      grunt.verbose.writeln('------------------ Unused files ------------------');
      grunt.verbose.writeln(diff.join("\n"));
    }
    var src ='';
    // Iterate over all specified file groups.
    required.forEach(function (file) {
      // Concat specified files.
      src += grunt.file.read(file);
    });
    if(opts.output && opts.outputFilename) {
      grunt.file.write(opts.output + '/' + opts.outputFilename + ".js", src);
    }

    deps = resolveDependencies(opts.resolveFrom, true);
    required = deps.required;
    diff = deps.diff;
    grunt.log.ok('Done, dependency graph for tablet has ' + required.length + ' files.');

    grunt.log.writeln('----------------- Required tablet files -----------------');
    grunt.log.writeln(required.join("\n"));

    if (diff && diff.length) {
      grunt.verbose.writeln('------------------ Unused tablet files ------------------');
      grunt.verbose.writeln(diff.join("\n"));
    }

    src ='';
    // Iterate over all specified file groups.
    required.forEach(function (file) {
      // Concat specified files.
      src += grunt.file.read(file);
    });
    if(opts.output && opts.outputFilename) {
      grunt.file.write(opts.output + '/' + opts.outputFilename + '-tablet.js', src);
    }

  });
};

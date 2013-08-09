(function (window, document, undefined) {
  "use strict";

  /*!
   * Mad props to http://github.com/23/resumable.js
   * Steffen Tiedemann Christensen, steffen@23company.com
   */

  var S3Resumable = function (opts) {
    if (!(this instanceof S3Resumable)) {
      return new S3Resumable(opts);
    }
    // SUPPORTED BY BROWSER?
    // Check if these features are support by the browser:
    // - File object type
    // - Blob object type
    // - FileList object type
    // - slicing files
    this.support = (
      ( File !== undefined )
      &&
      ( Blob !== undefined )
      &&
      ( FileList !== undefined )
      &&
      (!!Blob.prototype.webkitSlice||!!Blob.prototype.mozSlice||Blob.prototype.slice||false)
    );
    if (!this.support) {
      return false;
    }

    // PROPERTIES
    var $ = this, $h, S3ResumableFile, S3ResumableChunk, onDrop, onDragOver, appendFilesFromFileList;
    $.files = [];
    $.defaults = {
      chunkSize: 50 * 1024 * 1024,
      forceChunkSize: false,
      simultaneousUploads: 3,
      throttleProgressCallbacks: 0.5,
      preprocess: null,
      prioritizeFirstAndLastChunk: false,
      initiateTarget:'/',
      testChunks: true,
      testChunkTarget:'/',
      authorizeChunkTarget:'/',
      finalizeTarget:'/',
      generateUniqueIdentifier: null,
      maxChunkRetries: undefined,
      chunkRetryInterval: undefined,
      permanentErrors: [415, 500, 501],
      maxFiles: undefined,
      maxFilesErrorCallback: function (files, errorCount) {
        var maxFiles = $.getOpt('maxFiles');
        window.alert('Please upload ' + maxFiles + ' file' + (maxFiles === 1 ? '' : 's') + ' at a time.');
      },
      minFileSize: 5 * 1024 * 1024,
      minFileSizeErrorCallback:function (file, errorCount) {
        window.alert(file.fileName +' is too small, please upload files larger than ' + $h.formatSize($.getOpt('minFileSize')) + '.');
      },
      maxFileSize:undefined,
      maxFileSizeErrorCallback:function (file, errorCount) {
        window.alert(file.fileName +' is too large, please upload files less than ' + $h.formatSize($.getOpt('maxFileSize')) + '.');
      },
      fileType: [],
      fileTypeErrorCallback: function (file, errorCount) {
        window.alert(file.fileName +' has type not allowed, please upload files of type ' + $.getOpt('fileType') + '.');
      }
    };
    $.opts = opts||{};
    $.getOpt = function (o) {
      var $this = this, options;
      // Get multiple option if passed an array
      if(o instanceof Array) {
        options = {};
        _.each(o, function (option) {
          options[option] = $this.getOpt(option);
        });
        return options;
      }
      // Otherwise, just return a simple option
      if ($this instanceof S3ResumableChunk) {
        if ( $this.opts[o] !== undefined ) { return $this.opts[o]; }

        $this = $this.fileObj;
      }
      if ($this instanceof S3ResumableFile) {
        if ( $this.opts[o] !== undefined ) { return $this.opts[o]; }

        $this = $this.resumableObj;
      }
      if ($this instanceof S3Resumable) {
        if ( $this.opts[o] !== undefined ) { return $this.opts[o]; }

        return $this.defaults[o];
      }
    };

    // EVENTS
    // catchAll(event, ...)
    // fileSuccess(file), fileProgress(file), fileAdded(file, event), fileRetry(file), fileError(file, message),
    // complete(), progress(), error(message, file), pause()
    $.events = [];
    $.on = function (event,callback) {
      $.events.push(event.toLowerCase(), callback);
    };
    $.fire = function () {
      // `arguments` is an object, not array, in FF, so:
      var args = [], i, ev;

      for (i = 0; i < arguments.length; i += 1 ) {
        args.push(arguments[i]);
      }

      // Find event listeners, and support pseudo-event `catchAll`
      ev = args[0].toLowerCase();
      for (i = 0; i <= $.events.length; i+=2 ) {
        if ( $.events[i] === ev ) {
          $.events[i+1].apply($,args.slice(1));
        }

        if ( $.events[i] === 'catchall' ) {
          $.events[i+1].apply(null,args);
        }
      }

      if ( ev === 'fileerror') {
        $.fire('error', args[2], args[1]);
      }

      if ( ev === 'fileprogress') {
        $.fire('progress');
      }
    };

    // INTERNAL HELPER METHODS (handy, but ultimately not part of uploading)
    $h = {
      stopEvent: function (e) {
        e.stopPropagation();
        e.preventDefault();
      },
      // We need our own each, to break on a 'return false'
      each: function (o, callback) {
        try {
          _.each(o, function ( value, key ) {
            if ( callback(value, key) === false ) {
              throw {
                name: 'AbortIterationException'
              };
            }
          });
        } catch (e) {
          if ( e.name !== 'AbortIterationException' ) {
            throw e;
          }
        }
      },
      generateUniqueIdentifier:function (file) {
        var custom, relativePath, size;

        custom = $.getOpt('generateUniqueIdentifier');
        if(typeof custom === 'function') {
          return custom(file);
        }
        relativePath = file.webkitRelativePath||file.fileName||file.name; // Some confusion in different versions of Firefox
        size = file.size;
        return size + '-' + relativePath.replace(/[^0-9a-zA-Z_\-]/img, '');
      },
      formatSize:function (size) {
        if(size<1024) {
          return size + ' bytes';
        }
        if (size<1024*1024) {
          return (size/1024.0).toFixed(0) + ' KB';
        }
        if (size<1024*1024*1024) {
          return (size/1024.0/1024.0).toFixed(1) + ' MB';
        }
        return (size/1024.0/1024.0/1024.0).toFixed(1) + ' GB';
      }
    };

    onDrop = function (event) {
      $h.stopEvent(event);
      appendFilesFromFileList(event.dataTransfer.files, event);
    };
    onDragOver = function (e) {
      e.preventDefault();
    };

    // INTERNAL METHODS (both handy and responsible for the heavy load)
    appendFilesFromFileList = function (fileList, event) {
      // check for uploading too many files
      var errorCount = 0, o, files;
      o = $.getOpt(['maxFiles', 'minFileSize', 'maxFileSize', 'maxFilesErrorCallback', 'minFileSizeErrorCallback', 'maxFileSizeErrorCallback', 'fileType', 'fileTypeErrorCallback']);
      if ( o.maxFiles !== undefined && o.maxFiles < ( fileList.length + $.files.length ) ) {
        // if single-file upload, file is already added, and trying to add 1 new file, simply replace the already-added file
        if ( o.maxFiles === 1 && $.files.length === 1 && fileList.length === 1 ) {
          $.removeFile($.files[0]);
        } else {
          errorCount += 1;
          o.maxFilesErrorCallback(fileList, errorCount);
          return false;
        }
      }
      files = [];
      $h.each(fileList, function (file) {
        var f;

        file.name = file.fileName = file.fileName||file.name; // consistency across browsers for the error message

        if (o.fileType.length > 0 && !_.contains(o.fileType, file.type.split('/')[1])) {
          errorCount += 1;
          o.fileTypeErrorCallback(file, errorCount);
          return false;
        }

        if ( o.minFileSize !== undefined && file.size < o.minFileSize ) {
          errorCount += 1;
          o.minFileSizeErrorCallback(file, errorCount);
          return false;
        }
        if ( o.maxFileSize !== undefined && file.size > o.maxFileSize ) {
          errorCount += 1;
          o.maxFileSizeErrorCallback(file, errorCount);
          return false;
        }

        // directories have size === 0
        if (!$.getFromUniqueIdentifier($h.generateUniqueIdentifier(file))) {
          f = new S3ResumableFile($, file);
          $.files.push(f);
          files.push(f);
          $.fire('fileAdded', f, event);
        }
      });

      $.fire('filesAdded', files);
    };

    // INTERNAL OBJECT TYPES
    S3ResumableFile = function (resumableObj, file) {
      var $ = this, _error, chunkEvent, initiateHandler, params;

      $.opts = {};
      $.getOpt = resumableObj.getOpt;
      $._prevProgress = 0;
      $.resumableObj = resumableObj;
      $.file = file;
      $.fileName = file.fileName||file.name; // Some confusion in different versions of Firefox
      $.size = file.size;
      $.relativePath = file.webkitRelativePath || $.fileName;
      $.uniqueIdentifier = $h.generateUniqueIdentifier(file);
      $.multipartId = null;
      _error = false;

      // Callback when something happens within the chunk
      chunkEvent = function (event, message) {
        // event can be 'progress', 'success', 'error' or 'retry'
        switch(event){
        case 'progress':
          $.resumableObj.fire('fileProgress', $);
          break;
        case 'error':
          $.abort();
          _error = true;
          $.chunks = [];
          $.resumableObj.fire('fileError', $, message);
          break;
        case 'success':
          if (_error) {
            return;
          }

          $.resumableObj.fire('fileProgress', $); // it's at least progress

          if ( $.progress() === 1 ) {
            $.resumableObj.fire('fileSuccess', $, message);
          }
          break;
        case 'retry':
          $.resumableObj.fire('fileRetry', $);
          break;
        }
      };

      // Main code to set up a file object with chunks,
      // packaged to be able to handle retries if needed.
      $.chunks = [];
      $.abort = function () {
        // Stop current uploads
        _.each($.chunks, function (c) {
            if ( c.status() ==='uploading' ) {
              c.abort();
            }
          });
        $.resumableObj.fire('fileProgress', $);
      };
      $.cancel = function () {
        // Reset this file to be void
        var _chunks = $.chunks;
        $.chunks = [];
        // Stop current uploads
        _.each(_chunks, function (c) {
            if ( c.status() === 'uploading' )  {
              c.abort();
              $.resumableObj.uploadNextChunk();
            }
          });
        $.resumableObj.removeFile($);
        $.resumableObj.fire('fileProgress', $);
      };
      $.retry = function () {
        $.bootstrap();
        $.resumableObj.upload();
      };
      $.bootstrap = function () {
        var round, offset;
        $.abort();
          _error = false;
        // Rebuild stack of chunks from file
        $.chunks = [];
        $._prevProgress = 0;
        round = $.getOpt('forceChunkSize') ? Math.ceil : Math.floor;
        for (offset=0; offset<Math.max(round($.file.size/$.getOpt('chunkSize')),1); offset += 1) {
          $.chunks.push(new S3ResumableChunk($.resumableObj, $, offset, chunkEvent));
        }
      };
      $.progress = function () {
        var ret, error;
        if (_error) {
          return 1;
        }
        // Sum up progress across everything
        ret = 0;
        error = false;
        _.each($.chunks, function (c) {
            if( c.status() === 'error' ) {
              error = true;
            }
            ret += c.progress(true); // get chunk progress relative to entire file
          });
        ret = (error ? 1 : (ret>0.999 ? 1 : ret));
        ret = Math.max($._prevProgress, ret); // We don't want to lose percentages when an upload is paused
        $._prevProgress = ret;
        return ret;
      };
      $.isUploading = function () {
        var uploading = false;
        $h.each($.chunks, function (chunk) {
          if ( chunk.status() === 'uploading' ) {
            uploading = true;
            return false;
          }
        });
        return uploading;
      };

      // Bootstrap and return
      $.bootstrap();

      // Initiate the transfer
      $.xhr = new XMLHttpRequest();

      initiateHandler = function () {
        var multipart_data = JSON.parse($.xhr.responseText);
        $.multipartId = multipart_data.multipart_id;
      };
      $.xhr.addEventListener("load", initiateHandler, false);
      $.xhr.addEventListener("error", initiateHandler, false);

      params = [];

      // Add extra data to identify chunk
      params.push(['local_identifier', encodeURIComponent($.uniqueIdentifier)].join('='));
      params.push(['s3_object_name', encodeURIComponent($.fileName)].join('='));

      // Append the relevant chunk and send it. Should be synchronous.
      $.xhr.open("POST", $.getOpt('initiateTarget') + '?' + params.join('&'), false);
      $.xhr.send(null);

      return this;
    };

    S3ResumableChunk = function (resumableObj, fileObj, offset, callback) {
      var $ = this, chunkSize;
      $.opts = {};
      $.getOpt = resumableObj.getOpt;
      $.resumableObj = resumableObj;
      $.fileObj = fileObj;
      $.fileObjSize = fileObj.size;
      $.offset = offset;
      $.callback = callback;
      $.lastProgressCallback = new Date();
      $.tested = false;
      $.retries = 0;
      $.preprocessState = 0; // 0 = unprocessed, 1 = processing, 2 = finished

      // Computed properties
      chunkSize = $.getOpt('chunkSize');
      $.loaded = 0;
      $.startByte = $.offset*chunkSize;
      $.endByte = Math.min($.fileObjSize, ($.offset+1)*chunkSize);
      if ($.fileObjSize-$.endByte < chunkSize && !$.getOpt('forceChunkSize')) {
        // The last chunk will be bigger than the chunk size, but less than 2*chunkSize
        $.endByte = $.fileObjSize;
      }
      $.xhr = null;

      // test() makes a GET request without any data to see if the chunk has already been uploaded in a previous session
      $.test = function () {
        var testHandler, params;

        // Set up request and listen for event
        $.xhr = new XMLHttpRequest();

        testHandler = function () {
          var status, chunks, matching_chunks;

          $.tested = true;
          status = $.status();
          chunks = JSON.parse($.message());
          matching_chunks = _.filter(chunks.parts, function (e) { return e.part_number === ($.offset+1); } );

          if(status==='success' && matching_chunks.length >= 1) {
            $.callback(status, $.message());
            $.resumableObj.uploadNextChunk();
          } else {
            $.send();
          }
        };

        $.xhr.addEventListener("load", testHandler, false);
        $.xhr.addEventListener("error", testHandler, false);

        // Add data from the query options
        params = [];
        // Add extra data to identify chunk
        params.push(['current_multipart_id', encodeURIComponent($.fileObj.multipartId)].join('='));

        // Append the relevant chunk and send it
        $.xhr.open("GET", $.getOpt('testChunkTarget') + '?' + params.join('&'));
        $.xhr.send(null);
      };

      $.preprocessFinished = function () {
        $.preprocessState = 2;
        $.send();
      };

      // send() uploads the actual data in a POST call
      $.send = function () {
        var preprocess = $.getOpt('preprocess'), signatureHandler, params;
        if(typeof preprocess === 'function') {
          switch($.preprocessState) {
            case 0: preprocess($); $.preprocessState = 1; return;
            case 1: return;
            case 2: break;
          }
        }
        if($.getOpt('testChunks') && !$.tested) {
          $.test();
          return;
        }

        // First, we need the signature
        $.xhr = new XMLHttpRequest();

        signatureHandler = function () {
          var status = $.status(), sig_data = JSON.parse($.message()), doneHandler, headers, func, params, query, bytes, data, target;

          if(status==='success') {

            // Now we have the relevant signature data, we can initiate the upload.

            // Set up request and listen for event
            $.xhr = new XMLHttpRequest();

            // Progress
            $.xhr.upload.addEventListener("progress", function (e) {
              if( (new Date()) - $.lastProgressCallback > $.getOpt('throttleProgressCallbacks') * 1000 ) {
                $.callback('progress');
                $.lastProgressCallback = (new Date());
              }
              $.loaded=e.loaded||0;
            }, false);
            $.loaded = 0;
            $.callback('progress');

            // Done (either done, failed or retry)
            doneHandler = function () {
              var status = $.status(), retryInterval;

              if(status==='success'||status==='error') {
                $.callback(status, $.message());
                $.resumableObj.uploadNextChunk();
              } else {
                $.callback('retry', $.message());
                $.abort();
                $.retries += 1;
                retryInterval = $.getOpt('chunkRetryInterval');
                if(retryInterval !== undefined) {
                  window.setTimeout($.send, retryInterval);
                } else {
                  $.send();
                }
              }
            };
            $.xhr.addEventListener("load", doneHandler, false);
            $.xhr.addEventListener("error", doneHandler, false);

            headers = {
              'Authorization': 'AWS ' + $.getOpt('awsAccessKeyId') + ':' + sig_data.signature,
              'x-amz-date': sig_data.date
            };

            func = ($.fileObj.file.slice ? 'slice' : ($.fileObj.file.mozSlice ? 'mozSlice' : ($.fileObj.file.webkitSlice ? 'webkitSlice' : 'slice')));
            bytes  = $.fileObj.file[func]($.startByte,$.endByte);
            data   = null;
            target = $.getOpt('s3BucketEndpoint');

            // Add the object name
            target += $.fileObj.fileName;

            // Add data from the query options
            data = bytes;

            // Query variables
            params = [];
            query = {
              partNumber: $.offset+1,
              uploadId: sig_data.multipart_id
            };

            _.each(query, function (v, k) {
              params.push([encodeURIComponent(k), encodeURIComponent(v)].join('='));
            });
            target += '?' + params.join('&');

            $.xhr.open('PUT', target);
            _.each(headers, function (v, k) {
              $.xhr.setRequestHeader(k, v);
            });
            $.xhr.send(data);

          } else {
            // Houston, we have a problem.
            window.alert('Error on obtaining authorization token for chunk ' + $.offset+1);
          }
        };
        $.xhr.addEventListener("load", signatureHandler, false);
        $.xhr.addEventListener("error", signatureHandler, false);

        params = [];
        // Add extra data to identify chunk
        params.push(['chunk_number', encodeURIComponent($.offset+1)].join('='));
        params.push(['object_name', encodeURIComponent($.fileObj.fileName)].join('='));
        params.push(['current_multipart_id', encodeURIComponent($.fileObj.multipartId)].join('='));

        $.xhr.open("GET", $.getOpt('authorizeChunkTarget') + '?' + params.join('&'));
        $.xhr.send(null);
      };
      $.abort = function () {
        // Abort and reset
        if ( $.xhr ) {
          $.xhr.abort();
        }

        $.xhr = null;
      };
      $.status = function () {
        // Returns: 'pending', 'uploading', 'success', 'error'
        if(!$.xhr) {
          return 'pending';
        }
        if($.xhr.readyState<4) {
          // Status is really 'OPENED', 'HEADERS_RECEIVED' or 'LOADING' - meaning that stuff is happening
          return 'uploading';
        }

        if($.xhr.status===200) {
          // HTTP 200, perfect
          return 'success';
        }

        if(_.contains($.getOpt('permanentErrors'), $.xhr.status) || $.retries >= $.getOpt('maxChunkRetries')) {
          // HTTP 415/500/501, permanent error
          return 'error';
        }

        // this should never happen, but we'll reset and queue a retry
        // a likely case for this would be 503 service unavailable
        $.abort();
        return 'pending';
      };
      $.message = function () {
        return $.xhr ? $.xhr.responseText : '';
      };
      $.progress = function (relative) {
        var factor, s;
        if( relative === undefined ) {
          relative = false;
        }
        factor = (relative ? ($.endByte-$.startByte)/$.fileObjSize : 1);
        s = $.status();
        switch (s) {
          case 'success':
          case 'error':
            return 1 * factor;
          case 'pending':
            return 0 * factor;
          default:
            return $.loaded/($.endByte-$.startByte)*factor;
        }
      };

      return this;
    };

    // QUEUE
    $.uploadNextChunk = function () {
      var found = false, outstanding = false;

      // In some cases (such as videos) it's really handy to upload the first
      // and last chunk of a file quickly; this let's the server check the file's
      // metadata and determine if there's even a point in continuing.
      if ($.getOpt('prioritizeFirstAndLastChunk')) {
        $h.each($.files, function (file) {
          if(file.chunks.length && file.chunks[0].status()==='pending' && file.chunks[0].preprocessState === 0) {
            file.chunks[0].send();
            found = true;
            return false;
          }
          if(file.chunks.length>1 && file.chunks[file.chunks.length-1].status()==='pending' && file.chunks[0].preprocessState === 0) {
            file.chunks[file.chunks.length-1].send();
            found = true;
            return false;
          }
        });
        if ( found ) {
          return true;
        }
      }

      // Now, simply look for the next, best thing to upload
      $h.each($.files, function (file) {
        $h.each(file.chunks, function (chunk) {
          if(chunk.status()==='pending' && chunk.preprocessState === 0) {
            chunk.send();
            found = true;
            return false;
          }
        });
        if ( found ) {
          return false;
        }
      });
      if ( found ) {
        return true;
      }

      // The are no more outstanding chunks to upload, check is everything is done
      $h.each($.files, function (file) {
        var finalizeXhr, params;

        $h.each(file.chunks, function (chunk) {
          var status = chunk.status();
          if(status==='pending' || status==='uploading' || chunk.preprocessState === 1) {
            outstanding = true;
            return false;
          }
        });

        if(outstanding) {
          return false;
        }

        // All chunks for this file have been uploaded.
        // Now, let's tell our server to tell S3 to reassamble the parts over there.

        finalizeXhr = new XMLHttpRequest();

        params = [];
        // Add extra data to identify chunk
        params.push(['current_multipart_id', encodeURIComponent(file.multipartId)].join('='));

        // Should be synchronous.
        finalizeXhr.open("POST", $.getOpt('finalizeTarget') + '?' + params.join('&'), false);
        finalizeXhr.send(null);
      });

      if(!outstanding) {
        // All chunks have been uploaded, complete
        $.fire('complete');
      }

      return false;
    };


    // PUBLIC METHODS FOR RESUMABLE.JS
    $.assignBrowse = function (domNodes, isDirectory) {
      if ( domNodes.length === undefined ) {
        domNodes = [domNodes];
      }

      // We will create an <input> and overlay it on the domNode
      // (crappy, but since HTML5 doesn't have a cross-browser.browse() method we haven't a choice.
      //  FF4+ allows click() for this though: https://developer.mozilla.org/en/using_files_from_web_applications)
      _.each(domNodes, function (domNode) {
          var input, maxFiles;
          if(domNode.tagName==='INPUT' && domNode.type==='file'){
              input = domNode;
          } else {
              input = document.createElement('input');
              input.setAttribute('type', 'file');
              // Place <input /> with the dom node an position the input to fill the entire space
              domNode.style.display = 'inline-block';
              domNode.style.position = 'relative';
              input.style.position = 'absolute';
              input.style.top = input.style.left = input.style.bottom = input.style.right = 0;
              input.style.opacity = 0;
              input.style.cursor = 'pointer';
              domNode.appendChild(input);
          }
          maxFiles = $.getOpt('maxFiles');
          if ( maxFiles === undefined || maxFiles !== 1 ){
            input.setAttribute('multiple', 'multiple');
          } else {
            input.removeAttribute('multiple');
          }
          if(isDirectory){
            input.setAttribute('webkitdirectory', 'webkitdirectory');
          } else {
            input.removeAttribute('webkitdirectory');
          }
          // When new files are added, simply append them to the overall list
          input.addEventListener('change', function (e) {
              appendFilesFromFileList(e.target.files);
              e.target.value = '';
          }, false);
      });
    };
    $.assignDrop = function (domNodes) {
      if( domNodes.length === undefined ) {
        domNodes = [domNodes];
      }

      _.each(domNodes, function (domNode) {
          domNode.addEventListener('dragover', onDragOver, false);
          domNode.addEventListener('drop', onDrop, false);
        });
    };
    $.unAssignDrop = function (domNodes) {
      if ( domNodes.length === undefined ) {
        domNodes = [domNodes];
      }

      _.each(domNodes, function (domNode) {
          domNode.removeEventListener('dragover', onDragOver);
          domNode.removeEventListener('drop', onDrop);
        });
    };
    $.isUploading = function () {
      var uploading = false;
      $h.each($.files, function (file) {
        if (file.isUploading()) {
          uploading = true;
          return false;
        }
      });
      return uploading;
    };
    $.upload = function () {
      var num;
      // Make sure we don't start too many uploads at once
      if ( $.isUploading() ) {
        return;
      }

      // Initiate the uploading action.

      // All clear.
      // Kick off the queue
      $.fire('uploadStart');
      for (num=1; num <= $.getOpt('simultaneousUploads'); num += 1) {
        $.uploadNextChunk();
      }
    };
    $.pause = function () {
      // Resume all chunks currently being uploaded
      _.each($.files, function (file) {
          file.abort();
        });
      $.fire('pause');
    };
    $.cancel = function () {
      _.each($.files, function (file) {
          file.cancel();
        });
      $.fire('cancel');
    };
    $.progress = function () {
      var totalDone = 0, totalSize = 0;

      // Resume all chunks currently being uploaded
      _.each($.files, function (file) {
          totalDone += file.progress()*file.size;
          totalSize += file.size;
        });
      return totalSize > 0 ? totalDone/totalSize : 0;
    };
    $.addFile = function (file) {
      appendFilesFromFileList([file]);
    };
    $.removeFile = function (file) {
      var i;
      for (i = $.files.length - 1; i >= 0; i -= 1) {
        if($.files[i] === file) {
          $.files.splice(i, 1);
        }
      }
    };
    $.getFromUniqueIdentifier = function (uniqueIdentifier) {
      var ret = false;
      _.each($.files, function (f) {
          if ( f.uniqueIdentifier === uniqueIdentifier ) {
            ret = f;
          }
        });
      return ret;
    };
    $.getSize = function () {
      var totalSize = 0;
      _.each($.files, function (file) {
          totalSize += file.size;
        });
      return totalSize;
    };

    return this;
  };

  window.S3Resumable = S3Resumable;

}(window, document));

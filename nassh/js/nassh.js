// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';

var nassh = {};

/**
 * Non-null if nassh is running as an extension.
 */
nassh.browserAction =
    window.browser && browser.browserAction ? browser.browserAction :
    window.chrome && chrome.browserAction ? chrome.browserAction :
    null;

lib.registerInit(
    'nassh',
    /**
     * Register a static initializer for nassh.*.
     *
     * @param {function()} onInit The function lib.init() wants us to invoke
     *     when initialization is complete.
     */
    function(onInit) {
      if (!nassh.defaultStorage) {
        nassh.defaultStorage = hterm.defaultStorage;
      }

      // Since our translation process only preserves \n (and discards \r), we
      // have to manually insert them ourselves.
      hterm.messageManager.useCrlf = true;

      onInit();
    });

/**
 * Loads messages for when chrome.i18n is not available.
 *
 * This should only be used in contexts outside of extensions/apps.
 *
 * @param {function()} callback Invoked when message loading is complete.
 */
nassh.loadMessages = async function(callback) {
  // Load hterm.messageManager from /_locales/<lang>/messages.json.
  hterm.messageManager.useCrlf = true;
  const url = lib.f.getURL('/_locales/$1/messages.json');
  await hterm.messageManager.findAndLoadMessages(url);
  callback();
};

/**
 * Return a formatted message in the current locale.
 *
 * @param {string} name The name of the message to return.
 * @param {!Array=} args The message arguments, if required.
 * @return {string} The localized & formatted message.
 */
nassh.msg = function(name, args) {
  return hterm.messageManager.get(name, args, name);
};

/**
 * Request the persistent HTML5 filesystem for this extension.
 *
 * This will also create the /.ssh/ directory if it does not exits.
 *
 * @return {!Promise<!FileSystem>} The root filesystem handle.
 */
nassh.getFileSystem = function() {
  const requestFS = window.requestFileSystem || window.webkitRequestFileSystem;

  return new Promise((resolve, reject) => {
    function onFileSystem(fileSystem) {
      // We create /.ssh/identity/ subdir for storing keys.  We need a dedicated
      // subdir for users to import files to avoid collisions with standard ssh
      // config files.
      lib.fs.getOrCreateDirectory(fileSystem.root, '/.ssh/identity')
        .then(() => resolve(fileSystem))
        .catch(reject);
    }

    requestFS(window.PERSISTENT,
              16 * 1024 * 1024,
              onFileSystem,
              lib.fs.err('Error initializing filesystem', reject));
  });
};

/**
 * Export the current list of nassh connections, and any hterm profiles
 * they reference.
 *
 * This is method must be given a completion callback because the hterm
 * profiles need to be loaded asynchronously.
 *
 * @param {function(!Object)} onComplete Callback to be invoked when export is
 *     complete.
 *   The callback will receive a plain JS object representing the state of
 *   nassh preferences.  The object can be passed back to
 *   nassh.importPreferences.
 */
nassh.exportPreferences = function(onComplete) {
  var pendingReads = 0;
  var rv = {};

  var onReadStorage = function(profile, prefs) {
    rv.hterm[profile] = prefs.exportAsJson();
    if (--pendingReads < 1)
      onComplete(rv);
  };

  rv.magic = 'nassh-prefs';
  rv.version = 1;

  var nasshPrefs = new nassh.PreferenceManager();
  nasshPrefs.readStorage(function() {
    // Export all the connection settings.
    rv.nassh = nasshPrefs.exportAsJson();

    // Save all the profiles.
    rv.hterm = {};
    hterm.PreferenceManager.listProfiles((profiles) => {
      profiles.forEach((profile) => {
        rv.hterm[profile] = null;
        const prefs = new hterm.PreferenceManager(profile);
        prefs.readStorage(onReadStorage.bind(null, profile, prefs));
        pendingReads++;
      });

      if (profiles.length == 0)
        onComplete(rv);
    });
  });
};

/**
 * Import a preferences object.
 *
 * This will not overwrite any existing preferences.
 *
 * @param {!Object} prefsObject A preferences object created with
 *     nassh.exportPreferences.
 * @param {function()=} onComplete A callback to be invoked when the import is
 *     complete.
 */
nassh.importPreferences = function(prefsObject, onComplete) {
  var pendingReads = 0;

  var onReadStorage = function(terminalProfile, prefs) {
    prefs.importFromJson(prefsObject.hterm[terminalProfile]);
    if (--pendingReads < 1 && onComplete) {
      onComplete();
    }
  };

  if (prefsObject.magic != 'nassh-prefs')
    throw new Error('Not a JSON object or bad value for \'magic\'.');

  if (prefsObject.version != 1)
    throw new Error('Bad version, expected 1, got: ' + prefsObject.version);

  var nasshPrefs = new nassh.PreferenceManager();
  nasshPrefs.importFromJson(prefsObject.nassh, () => {
    for (var terminalProfile in prefsObject.hterm) {
      var prefs = new hterm.PreferenceManager(terminalProfile);
      prefs.readStorage(onReadStorage.bind(null, terminalProfile, prefs));
      pendingReads++;
    }
  });
};

/**
 * Create a new window to the options page for customizing preferences.
 */
nassh.openOptionsPage = function() {
  const fallback = () => {
    lib.f.openWindow('/html/nassh_preferences_editor.html');
  };

  if (window.chrome && chrome.runtime && chrome.runtime.openOptionsPage) {
    // This is a bit convoluted because, in some scenarios (e.g. crosh), the
    // openOptionsPage helper might fail.  If it does, fallback to a tab.
    chrome.runtime.openOptionsPage(() => {
      const err = lib.f.lastError();
      if (err) {
        console.warn(err);
        fallback();
      }
    });
  } else
    fallback();
};

/** Reload window. */
nassh.reloadWindow = function() {
  document.location.hash = '';
  document.location.reload();
};

/**
 * Register this extension to handle URIs like ssh://.
 *
 * The protocol should be one allowed by the specifications:
 * https://html.spec.whatwg.org/multipage/webappapis.html#webappapis
 * https://chromium.googlesource.com/chromium/src/+blame/master/third_party/WebKit/Source/modules/navigatorcontentutils/NavigatorContentUtils.cpp
 * https://www.iana.org/assignments/uri-schemes/prov/sftp
 *
 * @param {string} proto The protocol name to register.
 */
nassh.registerProtocolHandler = function(proto) {
  try {
    navigator.registerProtocolHandler(
        proto,
        chrome.runtime.getURL('/html/nassh.html#uri:%s'),
        chrome.runtime.getManifest().name);
  } catch (e) {
    console.error(`Unable to register '${proto}' handler:`, e);
  }

  // Not all runtimes allow direct registration, so also register with the
  // 'web+' prefix just in case.
  if (!proto.startsWith('web+')) {
    nassh.registerProtocolHandler(`web+${proto}`);
  }
};

/**
 * Disable automatic tab discarding for our windows.
 *
 * Newer versions of Chrome are a bit more proactive in discarding tabs.  Signal
 * that we shouldn't be discarded as restarting crosh/ssh sessions is not easy
 * for users.
 * https://crbug.com/868155
 *
 * Note: This code updates tab properties asynchronously, but that should be
 * fine for our usage as we don't generally create windows/tabs on the fly.
 */
nassh.disableTabDiscarding = function() {
  if (window.chrome && chrome.tabs) {
    chrome.tabs.getCurrent((tab) => {
      chrome.tabs.update(tab.id, {autoDiscardable: false});
    });
  }
};

/**
 * Convert a base64url encoded string to the base64 encoding.
 *
 * The difference here is in the last two characters of the alphabet.
 * So converting between them is easy.
 *
 * base64: https://tools.ietf.org/html/rfc4648#section-4
 *   62 +
 *   63 /
 * base64url: https://tools.ietf.org/html/rfc4648#section-5
 *   62 -
 *   63 _
 *
 * We re-add any trailing = padding characters.
 *
 * @param {string} data The base64url encoded data.
 * @return {string} The data in base64 encoding.
 */
nassh.base64UrlToBase64 = function(data) {
  const replacements = {'-': '+', '_': '/'};
  let ret = data.replace(/[-_]/g, (ch) => replacements[ch]);

  switch (ret.length % 4) {
    case 1:
      throw new Error(`Invalid base64url length: ${ret.length}`);

    case 2:
      ret += '==';
      break;

    case 3:
      ret += '=';
      break;
  }

  return ret;
};

/**
 * Convert a base64 encoded string to the base64url encoding.
 *
 * This is the inverse of nassh.base64UrlToBase64.
 *
 * We strip off any = padding characters too.
 *
 * @param {string} data The base64 encoded data.
 * @return {string} The data in base64url encoding.
 */
nassh.base64ToBase64Url = function(data) {
  const replacements = {'+': '-', '/': '_', '=': ''};
  return data.replace(/[+/=]/g, (ch) => replacements[ch]);
};

/**
 * Workaround missing chrome.runtime in older versions of Chrome.
 *
 * As detailed in https://crbug.com/925118, the chrome.runtime object might be
 * missing when we run.  In order to workaround it, we need to reload the page.
 * While this is fixed in R72+, we unfortunately have EOL Chromebooks that will
 * never be able to upgrade to that version, so we have to keep this around for
 * a long time -- once we update minimum_chrome_version in the manifest to 72+.
 *
 * @return {boolean} True if bug was detected and the caller should halt all
 *     processing.
 */
nassh.workaroundMissingChromeRuntime = function() {
  // Chrome has a bug where it sometimes doesn't initialize chrome.runtime.
  // Try and workaround it by forcing a refresh.  https://crbug.com/924656
  if (window.chrome && !window.chrome.runtime) {
    console.warn('chrome.runtime is undefined; reloading to workaround ' +
                 'https://crbug.com/925118');
    document.location.reload();
    return true;
  }

  return false;
};

/**
 * Helper to get the background page once it's fully initialized.
 *
 * If the background page doesn't exist yet (fresh startup, or it's gone quiet
 * and Chrome automatically exited it), then the getBackgroundPage helper will
 * create a new instance on the fly and return it.  Unfortunately, we will often
 * then try to call funcs in it directly before it's finished initializing which
 * will cause random failures as it hits race conditions.
 *
 * @return {!Promise<!Window>} A promise resolving to the background page once
 *     it is fully initialized.
 */
nassh.getBackgroundPage = function() {
  if (!window.chrome || !chrome.runtime || !chrome.runtime.getBackgroundPage) {
    return Promise.reject();
  }

  return new Promise((resolve, reject) => {
    chrome.runtime.getBackgroundPage((bg) => {
      if (bg === undefined) {
        return reject();
      }

      const checkInitialized = () => {
        if (bg.loaded) {
          return resolve(bg);
        }
        console.log('Background page not initialized; retrying');
        setTimeout(checkInitialized, 100);
      };
      checkInitialized();
    });
  });
};

/**
 * Generate an SGR escape sequence.
 *
 * @param {!Object=} settings
 * @return {string} The SGR escape sequence.
 */
nassh.sgrSequence = function({bold, faint, italic, underline, fg, bg} = {}) {
  let parts = [];
  if (bold) {
    parts.push('1');
  }
  if (faint) {
    parts.push('2');
  }
  if (italic) {
    parts.push('3');
  }
  if (underline) {
    parts.push('4');
  }
  if (fg) {
    parts.push(fg);
  }
  if (bg) {
    parts.push(bg);
  }
  return `\x1b[${parts.join(';')}m`;
};

/**
 * Apply SGR styling to text.
 *
 * This will reset the SGR style to the default.
 *
 * @param {string} text The text to be stylized.
 * @param {!Object=} settings The SGR settings to apply.
 * @return {string} The text wrapped in SGR escape sequences.
 */
nassh.sgrText = function(text, settings) {
  return nassh.sgrSequence(settings) + text + nassh.sgrSequence();
};

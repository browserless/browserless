/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2016-present The uBlock Origin authors

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

/* global browser, IDBDatabase, indexedDB */

'use strict';

/******************************************************************************/

import lz4Codec from './lz4.js';
import µb from './background.js';
import webext from './webext.js';

/******************************************************************************/

// The code below has been originally manually imported from:
// Commit: https://github.com/nikrolls/uBlock-Edge/commit/d1538ea9bea89d507219d3219592382eee306134
// Commit date: 29 October 2016
// Commit author: https://github.com/nikrolls
// Commit message: "Implement cacheStorage using IndexedDB"

// The original imported code has been subsequently modified as it was not
// compatible with Firefox.
// (a Promise thing, see https://github.com/dfahlander/Dexie.js/issues/317)
// Furthermore, code to migrate from browser.storage.local to vAPI.storage
// has been added, for seamless migration of cache-related entries into
// indexedDB.

// https://bugzilla.mozilla.org/show_bug.cgi?id=1371255
//   Firefox-specific: we use indexedDB because browser.storage.local() has
//   poor performance in Firefox.
// https://github.com/uBlockOrigin/uBlock-issues/issues/328
//   Use IndexedDB for Chromium as well, to take advantage of LZ4
//   compression.
// https://github.com/uBlockOrigin/uBlock-issues/issues/399
//   Revert Chromium support of IndexedDB, use advanced setting to force
//   IndexedDB.
// https://github.com/uBlockOrigin/uBlock-issues/issues/409
//   Allow forcing the use of webext storage on Firefox.

const STORAGE_NAME = 'uBlock0CacheStorage';

// Default to webext storage.
const storageLocal = webext.storage.local;

const cacheStorage = {
    name: 'browser.storage.local',
    get(...args) {
        return storageLocal.get(...args).catch(reason => {
            console.log(reason);
        });
    },
    set(...args) {
        return storageLocal.set(...args).catch(reason => {
            console.log(reason);
        });
    },
    remove(...args) {
        return storageLocal.remove(...args).catch(reason => {
            console.log(reason);
        });
    },
    clear(...args) {
        return storageLocal.clear(...args).catch(reason => {
            console.log(reason);
        });
    },
    select: function(selectedBackend) {
        let actualBackend = selectedBackend;
        if ( actualBackend === undefined || actualBackend === 'unset' ) {
            actualBackend = vAPI.webextFlavor.soup.has('firefox')
                ? 'indexedDB'
                : 'browser.storage.local';
        }
        if ( actualBackend === 'indexedDB' ) {
            return selectIDB().then(success => {
                if ( success || selectedBackend === 'indexedDB' ) {
                    clearWebext();
                    return 'indexedDB';
                }
                clearIDB();
                return 'browser.storage.local';
            });
        }
        if ( actualBackend === 'browser.storage.local' ) {
            clearIDB();
        }
        return Promise.resolve('browser.storage.local');
        
    },
    error: undefined
};

// Not all platforms support getBytesInUse
if ( storageLocal.getBytesInUse instanceof Function ) {
    cacheStorage.getBytesInUse = function(...args) {
        return storageLocal.getBytesInUse(...args).catch(reason => {
            console.log(reason);
        });
    };
}

// Reassign API entries to that of indexedDB-based ones
const selectIDB = async function() {
    let db;
    let dbPromise;

    const noopfn = function () {
    };

    const disconnect = function() {
        dbTimer.off();
        if ( db instanceof IDBDatabase ) {
            db.close();
            db = undefined;
        }
    };

    const dbTimer = vAPI.defer.create(( ) => {
        disconnect();
    });

    const keepAlive = function() {
        dbTimer.offon(Math.max(
            µb.hiddenSettings.autoUpdateAssetFetchPeriod * 2 * 1000,
            180000
        ));
    };

    // https://github.com/gorhill/uBlock/issues/3156
    //   I have observed that no event was fired in Tor Browser 7.0.7 +
    //   medium security level after the request to open the database was
    //   created. When this occurs, I have also observed that the `error`
    //   property was already set, so this means uBO can detect here whether
    //   the database can be opened successfully. A try-catch block is
    //   necessary when reading the `error` property because we are not
    //   allowed to read this property outside of event handlers in newer
    //   implementation of IDBRequest (my understanding).

    const getDb = function() {
        keepAlive();
        if ( db !== undefined ) {
            return Promise.resolve(db);
        }
        if ( dbPromise !== undefined ) {
            return dbPromise;
        }
        dbPromise = new Promise(resolve => {
            let req;
            try {
                req = indexedDB.open(STORAGE_NAME, 1);
                if ( req.error ) {
                    console.log(req.error);
                    req = undefined;
                }
            } catch(ex) {
            }
            if ( req === undefined ) {
                db = null;
                dbPromise = undefined;
                return resolve(null);
            }
            req.onupgradeneeded = function(ev) {
                // https://github.com/uBlockOrigin/uBlock-issues/issues/2725
                //   If context Firefox + incognito mode, fall back to
                //   browser.storage.local for cache storage purpose.
                if (
                    vAPI.webextFlavor.soup.has('firefox') &&
                    browser.extension.inIncognitoContext === true
                ) {
                    return req.onerror();
                }
                if ( ev.oldVersion === 1 ) { return; }
                try {
                    const db = ev.target.result;
                    db.createObjectStore(STORAGE_NAME, { keyPath: 'key' });
                } catch(ex) {
                    req.onerror();
                }
            };
            req.onsuccess = function(ev) {
                if ( resolve === undefined ) { return; }
                req = undefined;
                db = ev.target.result;
                dbPromise = undefined;
                resolve(db);
                resolve = undefined;
            };
            req.onerror = req.onblocked = function() {
                if ( resolve === undefined ) { return; }
                req = undefined;
                console.log(this.error);
                db = null;
                dbPromise = undefined;
                resolve(null);
                resolve = undefined;
            };
            vAPI.defer.once(5000).then(( ) => {
                if ( resolve === undefined ) { return; }
                db = null;
                dbPromise = undefined;
                resolve(null);
                resolve = undefined;
            });
        });
        return dbPromise;
    };

    const fromBlob = function(data) {
        if ( data instanceof Blob === false ) {
            return Promise.resolve(data);
        }
        return new Promise(resolve => {
            const blobReader = new FileReader();
            blobReader.onloadend = ev => {
                resolve(new Uint8Array(ev.target.result));
            };
            blobReader.readAsArrayBuffer(data);
        });
    };

    const toBlob = function(data) {
        const value = data instanceof Uint8Array
            ? new Blob([ data ])
            : data;
        return Promise.resolve(value);
    };

    const compress = function(store, key, data) {
        return lz4Codec.encode(data, toBlob).then(value => {
            store.push({ key, value });
        });
    };

    const decompress = function(store, key, data) {
        return lz4Codec.decode(data, fromBlob).then(data => {
            store[key] = data;
        });
    };

    const getFromDb = async function(keys, keyvalStore, callback) {
        if ( typeof callback !== 'function' ) { return; }
        if ( keys.length === 0 ) { return callback(keyvalStore); }
        const promises = [];
        const gotOne = function() {
            if ( typeof this.result !== 'object' ) { return; }
            const { key, value } = this.result;
            keyvalStore[key] = value;
            if ( value instanceof Blob === false ) { return; }
            promises.push(decompress(keyvalStore, key, value));
        };
        try {
            const db = await getDb();
            if ( !db ) { return callback(); }
            const transaction = db.transaction(STORAGE_NAME, 'readonly');
            transaction.oncomplete =
            transaction.onerror =
            transaction.onabort = ( ) => {
                Promise.all(promises).then(( ) => {
                    callback(keyvalStore);
                });
            };
            const table = transaction.objectStore(STORAGE_NAME);
            for ( const key of keys ) {
                const req = table.get(key);
                req.onsuccess = gotOne;
                req.onerror = noopfn;
            }
        }
        catch(reason) {
            console.info(`cacheStorage.getFromDb() failed: ${reason}`);
            callback();
        }
    };

    const visitAllFromDb = async function(visitFn) {
        const db = await getDb();
        if ( !db ) { return visitFn(); }
        const transaction = db.transaction(STORAGE_NAME, 'readonly');
        transaction.oncomplete =
        transaction.onerror =
        transaction.onabort = ( ) => visitFn();
        const table = transaction.objectStore(STORAGE_NAME);
        const req = table.openCursor();
        req.onsuccess = function(ev) {
            let cursor = ev.target && ev.target.result;
            if ( !cursor ) { return; }
            let entry = cursor.value;
            visitFn(entry);
            cursor.continue();
        };
    };

    const getAllFromDb = function(callback) {
        if ( typeof callback !== 'function' ) { return; }
        const promises = [];
        const keyvalStore = {};
        visitAllFromDb(entry => {
            if ( entry === undefined ) {
                Promise.all(promises).then(( ) => {
                    callback(keyvalStore);
                });
                return;
            }
            const { key, value } = entry;
            keyvalStore[key] = value;
            if ( entry.value instanceof Blob === false ) { return; }
            promises.push(decompress(keyvalStore, key, value));
        }).catch(reason => {
            console.info(`cacheStorage.getAllFromDb() failed: ${reason}`);
            callback();
        });
    };

    // https://github.com/uBlockOrigin/uBlock-issues/issues/141
    //   Mind that IDBDatabase.transaction() and IDBObjectStore.put()
    //   can throw:
    //   https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction
    //   https://developer.mozilla.org/en-US/docs/Web/API/IDBObjectStore/put

    const putToDb = async function(keyvalStore, callback) {
        if ( typeof callback !== 'function' ) {
            callback = noopfn;
        }
        const keys = Object.keys(keyvalStore);
        if ( keys.length === 0 ) { return callback(); }
        const promises = [ getDb() ];
        const entries = [];
        const dontCompress =
            µb.hiddenSettings.cacheStorageCompression !== true;
        for ( const key of keys ) {
            const value = keyvalStore[key];
            const isString = typeof value === 'string';
            if ( isString === false || dontCompress ) {
                entries.push({ key, value });
                continue;
            }
            promises.push(compress(entries, key, value));
        }
        const finish = ( ) => {
            if ( callback === undefined ) { return; }
            let cb = callback;
            callback = undefined;
            cb();
        };
        try {
            const results = await Promise.all(promises);
            const db = results[0];
            if ( !db ) { return callback(); }
            const transaction = db.transaction(
                STORAGE_NAME,
                'readwrite'
            );
            transaction.oncomplete =
            transaction.onerror =
            transaction.onabort = finish;
            const table = transaction.objectStore(STORAGE_NAME);
            for ( const entry of entries ) {
                table.put(entry);
            }
        } catch (ex) {
            finish();
        }
    };

    const deleteFromDb = async function(input, callback) {
        if ( typeof callback !== 'function' ) {
            callback = noopfn;
        }
        const keys = Array.isArray(input) ? input.slice() : [ input ];
        if ( keys.length === 0 ) { return callback(); }
        const finish = ( ) => {
            if ( callback === undefined ) { return; }
            let cb = callback;
            callback = undefined;
            cb();
        };
        try {
            const db = await getDb();
            if ( !db ) { return callback(); }
            const transaction = db.transaction(STORAGE_NAME, 'readwrite');
            transaction.oncomplete =
            transaction.onerror =
            transaction.onabort = finish;
            const table = transaction.objectStore(STORAGE_NAME);
            for ( const key of keys ) {
                table.delete(key);
            }
        } catch (ex) {
            finish();
        }
    };

    const clearDb = async function(callback) {
        if ( typeof callback !== 'function' ) {
            callback = noopfn;
        }
        try {
            const db = await getDb();
            if ( !db ) { return callback(); }
            const transaction = db.transaction(STORAGE_NAME, 'readwrite');
            transaction.oncomplete =
            transaction.onerror =
            transaction.onabort = ( ) => {
                callback();
            };
            transaction.objectStore(STORAGE_NAME).clear();
        }
        catch(reason) {
            console.info(`cacheStorage.clearDb() failed: ${reason}`);
            callback();
        }
    };

    await getDb();
    if ( !db ) { return false; }

    cacheStorage.name = 'indexedDB';
    cacheStorage.get = function get(keys) {
        return new Promise(resolve => {
            if ( keys === null ) {
                return getAllFromDb(bin => resolve(bin));
            }
            let toRead, output = {};
            if ( typeof keys === 'string' ) {
                toRead = [ keys ];
            } else if ( Array.isArray(keys) ) {
                toRead = keys;
            } else /* if ( typeof keys === 'object' ) */ {
                toRead = Object.keys(keys);
                output = keys;
            }
            getFromDb(toRead, output, bin => resolve(bin));
        });
    };
    cacheStorage.set = function set(keys) {
        return new Promise(resolve => {
            putToDb(keys, details => resolve(details));
        });
    };
    cacheStorage.remove = function remove(keys) {
        return new Promise(resolve => {
            deleteFromDb(keys, ( ) => resolve());
        });
    };
    cacheStorage.clear = function clear() {
        return new Promise(resolve => {
            clearDb(( ) => resolve());
        });
    };
    cacheStorage.getBytesInUse = function getBytesInUse() {
        return Promise.resolve(0);
    };
    return true;
};

// https://github.com/uBlockOrigin/uBlock-issues/issues/328
//   Delete cache-related entries from webext storage.
const clearWebext = async function() {
    const bin = await webext.storage.local.get('assetCacheRegistry');
    if (
        bin instanceof Object === false ||
        bin.assetCacheRegistry instanceof Object === false
    ) {
        return;
    }
    const toRemove = [
        'assetCacheRegistry',
        'assetSourceRegistry',
        'resourcesSelfie',
        'selfie'
    ];
    for ( const key in bin.assetCacheRegistry ) {
        if ( bin.assetCacheRegistry.hasOwnProperty(key) ) {
            toRemove.push('cache/' + key);
        }
    }
    webext.storage.local.remove(toRemove);
};

const clearIDB = function() {
    try {
        indexedDB.deleteDatabase(STORAGE_NAME);
    } catch(ex) {
    }
};

/******************************************************************************/

export default cacheStorage;

/******************************************************************************/

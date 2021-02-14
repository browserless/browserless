// NOTE: THis is a generated file! Please run it from puppeteer, and add a window export "window.puppeteer = require('puppeteer');"
require=(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
  'use strict'
  
  exports.byteLength = byteLength
  exports.toByteArray = toByteArray
  exports.fromByteArray = fromByteArray
  
  var lookup = []
  var revLookup = []
  var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array
  
  var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  for (var i = 0, len = code.length; i < len; ++i) {
    lookup[i] = code[i]
    revLookup[code.charCodeAt(i)] = i
  }
  
  // Support decoding URL-safe base64 strings, as Node.js does.
  // See: https://en.wikipedia.org/wiki/Base64#URL_applications
  revLookup['-'.charCodeAt(0)] = 62
  revLookup['_'.charCodeAt(0)] = 63
  
  function getLens (b64) {
    var len = b64.length
  
    if (len % 4 > 0) {
      throw new Error('Invalid string. Length must be a multiple of 4')
    }
  
    // Trim off extra bytes after placeholder bytes are found
    // See: https://github.com/beatgammit/base64-js/issues/42
    var validLen = b64.indexOf('=')
    if (validLen === -1) validLen = len
  
    var placeHoldersLen = validLen === len
      ? 0
      : 4 - (validLen % 4)
  
    return [validLen, placeHoldersLen]
  }
  
  // base64 is 4/3 + up to two characters of the original data
  function byteLength (b64) {
    var lens = getLens(b64)
    var validLen = lens[0]
    var placeHoldersLen = lens[1]
    return ((validLen + placeHoldersLen) * 3 / 4) - placeHoldersLen
  }
  
  function _byteLength (b64, validLen, placeHoldersLen) {
    return ((validLen + placeHoldersLen) * 3 / 4) - placeHoldersLen
  }
  
  function toByteArray (b64) {
    var tmp
    var lens = getLens(b64)
    var validLen = lens[0]
    var placeHoldersLen = lens[1]
  
    var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen))
  
    var curByte = 0
  
    // if there are placeholders, only get up to the last complete 4 chars
    var len = placeHoldersLen > 0
      ? validLen - 4
      : validLen
  
    var i
    for (i = 0; i < len; i += 4) {
      tmp =
        (revLookup[b64.charCodeAt(i)] << 18) |
        (revLookup[b64.charCodeAt(i + 1)] << 12) |
        (revLookup[b64.charCodeAt(i + 2)] << 6) |
        revLookup[b64.charCodeAt(i + 3)]
      arr[curByte++] = (tmp >> 16) & 0xFF
      arr[curByte++] = (tmp >> 8) & 0xFF
      arr[curByte++] = tmp & 0xFF
    }
  
    if (placeHoldersLen === 2) {
      tmp =
        (revLookup[b64.charCodeAt(i)] << 2) |
        (revLookup[b64.charCodeAt(i + 1)] >> 4)
      arr[curByte++] = tmp & 0xFF
    }
  
    if (placeHoldersLen === 1) {
      tmp =
        (revLookup[b64.charCodeAt(i)] << 10) |
        (revLookup[b64.charCodeAt(i + 1)] << 4) |
        (revLookup[b64.charCodeAt(i + 2)] >> 2)
      arr[curByte++] = (tmp >> 8) & 0xFF
      arr[curByte++] = tmp & 0xFF
    }
  
    return arr
  }
  
  function tripletToBase64 (num) {
    return lookup[num >> 18 & 0x3F] +
      lookup[num >> 12 & 0x3F] +
      lookup[num >> 6 & 0x3F] +
      lookup[num & 0x3F]
  }
  
  function encodeChunk (uint8, start, end) {
    var tmp
    var output = []
    for (var i = start; i < end; i += 3) {
      tmp =
        ((uint8[i] << 16) & 0xFF0000) +
        ((uint8[i + 1] << 8) & 0xFF00) +
        (uint8[i + 2] & 0xFF)
      output.push(tripletToBase64(tmp))
    }
    return output.join('')
  }
  
  function fromByteArray (uint8) {
    var tmp
    var len = uint8.length
    var extraBytes = len % 3 // if we have 1 byte left, pad 2 bytes
    var parts = []
    var maxChunkLength = 16383 // must be multiple of 3
  
    // go through the array every three bytes, we'll deal with trailing stuff later
    for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
      parts.push(encodeChunk(uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)))
    }
  
    // pad the end with zeros, but make sure to not forget the extra bytes
    if (extraBytes === 1) {
      tmp = uint8[len - 1]
      parts.push(
        lookup[tmp >> 2] +
        lookup[(tmp << 4) & 0x3F] +
        '=='
      )
    } else if (extraBytes === 2) {
      tmp = (uint8[len - 2] << 8) + uint8[len - 1]
      parts.push(
        lookup[tmp >> 10] +
        lookup[(tmp >> 4) & 0x3F] +
        lookup[(tmp << 2) & 0x3F] +
        '='
      )
    }
  
    return parts.join('')
  }
  
  },{}],2:[function(require,module,exports){
  
  },{}],3:[function(require,module,exports){
  (function (Buffer){(function (){
  /*!
   * The buffer module from node.js, for the browser.
   *
   * @author   Feross Aboukhadijeh <https://feross.org>
   * @license  MIT
   */
  /* eslint-disable no-proto */
  
  'use strict'
  
  var base64 = require('base64-js')
  var ieee754 = require('ieee754')
  
  exports.Buffer = Buffer
  exports.SlowBuffer = SlowBuffer
  exports.INSPECT_MAX_BYTES = 50
  
  var K_MAX_LENGTH = 0x7fffffff
  exports.kMaxLength = K_MAX_LENGTH
  
  /**
   * If `Buffer.TYPED_ARRAY_SUPPORT`:
   *   === true    Use Uint8Array implementation (fastest)
   *   === false   Print warning and recommend using `buffer` v4.x which has an Object
   *               implementation (most compatible, even IE6)
   *
   * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
   * Opera 11.6+, iOS 4.2+.
   *
   * We report that the browser does not support typed arrays if the are not subclassable
   * using __proto__. Firefox 4-29 lacks support for adding new properties to `Uint8Array`
   * (See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438). IE 10 lacks support
   * for __proto__ and has a buggy typed array implementation.
   */
  Buffer.TYPED_ARRAY_SUPPORT = typedArraySupport()
  
  if (!Buffer.TYPED_ARRAY_SUPPORT && typeof console !== 'undefined' &&
      typeof console.error === 'function') {
    console.error(
      'This browser lacks typed array (Uint8Array) support which is required by ' +
      '`buffer` v5.x. Use `buffer` v4.x if you require old browser support.'
    )
  }
  
  function typedArraySupport () {
    // Can typed array instances can be augmented?
    try {
      var arr = new Uint8Array(1)
      arr.__proto__ = { __proto__: Uint8Array.prototype, foo: function () { return 42 } }
      return arr.foo() === 42
    } catch (e) {
      return false
    }
  }
  
  Object.defineProperty(Buffer.prototype, 'parent', {
    enumerable: true,
    get: function () {
      if (!Buffer.isBuffer(this)) return undefined
      return this.buffer
    }
  })
  
  Object.defineProperty(Buffer.prototype, 'offset', {
    enumerable: true,
    get: function () {
      if (!Buffer.isBuffer(this)) return undefined
      return this.byteOffset
    }
  })
  
  function createBuffer (length) {
    if (length > K_MAX_LENGTH) {
      throw new RangeError('The value "' + length + '" is invalid for option "size"')
    }
    // Return an augmented `Uint8Array` instance
    var buf = new Uint8Array(length)
    buf.__proto__ = Buffer.prototype
    return buf
  }
  
  /**
   * The Buffer constructor returns instances of `Uint8Array` that have their
   * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
   * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
   * and the `Uint8Array` methods. Square bracket notation works as expected -- it
   * returns a single octet.
   *
   * The `Uint8Array` prototype remains unmodified.
   */
  
  function Buffer (arg, encodingOrOffset, length) {
    // Common case.
    if (typeof arg === 'number') {
      if (typeof encodingOrOffset === 'string') {
        throw new TypeError(
          'The "string" argument must be of type string. Received type number'
        )
      }
      return allocUnsafe(arg)
    }
    return from(arg, encodingOrOffset, length)
  }
  
  // Fix subarray() in ES2016. See: https://github.com/feross/buffer/pull/97
  if (typeof Symbol !== 'undefined' && Symbol.species != null &&
      Buffer[Symbol.species] === Buffer) {
    Object.defineProperty(Buffer, Symbol.species, {
      value: null,
      configurable: true,
      enumerable: false,
      writable: false
    })
  }
  
  Buffer.poolSize = 8192 // not used by this implementation
  
  function from (value, encodingOrOffset, length) {
    if (typeof value === 'string') {
      return fromString(value, encodingOrOffset)
    }
  
    if (ArrayBuffer.isView(value)) {
      return fromArrayLike(value)
    }
  
    if (value == null) {
      throw TypeError(
        'The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' +
        'or Array-like Object. Received type ' + (typeof value)
      )
    }
  
    if (isInstance(value, ArrayBuffer) ||
        (value && isInstance(value.buffer, ArrayBuffer))) {
      return fromArrayBuffer(value, encodingOrOffset, length)
    }
  
    if (typeof value === 'number') {
      throw new TypeError(
        'The "value" argument must not be of type number. Received type number'
      )
    }
  
    var valueOf = value.valueOf && value.valueOf()
    if (valueOf != null && valueOf !== value) {
      return Buffer.from(valueOf, encodingOrOffset, length)
    }
  
    var b = fromObject(value)
    if (b) return b
  
    if (typeof Symbol !== 'undefined' && Symbol.toPrimitive != null &&
        typeof value[Symbol.toPrimitive] === 'function') {
      return Buffer.from(
        value[Symbol.toPrimitive]('string'), encodingOrOffset, length
      )
    }
  
    throw new TypeError(
      'The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' +
      'or Array-like Object. Received type ' + (typeof value)
    )
  }
  
  /**
   * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
   * if value is a number.
   * Buffer.from(str[, encoding])
   * Buffer.from(array)
   * Buffer.from(buffer)
   * Buffer.from(arrayBuffer[, byteOffset[, length]])
   **/
  Buffer.from = function (value, encodingOrOffset, length) {
    return from(value, encodingOrOffset, length)
  }
  
  // Note: Change prototype *after* Buffer.from is defined to workaround Chrome bug:
  // https://github.com/feross/buffer/pull/148
  Buffer.prototype.__proto__ = Uint8Array.prototype
  Buffer.__proto__ = Uint8Array
  
  function assertSize (size) {
    if (typeof size !== 'number') {
      throw new TypeError('"size" argument must be of type number')
    } else if (size < 0) {
      throw new RangeError('The value "' + size + '" is invalid for option "size"')
    }
  }
  
  function alloc (size, fill, encoding) {
    assertSize(size)
    if (size <= 0) {
      return createBuffer(size)
    }
    if (fill !== undefined) {
      // Only pay attention to encoding if it's a string. This
      // prevents accidentally sending in a number that would
      // be interpretted as a start offset.
      return typeof encoding === 'string'
        ? createBuffer(size).fill(fill, encoding)
        : createBuffer(size).fill(fill)
    }
    return createBuffer(size)
  }
  
  /**
   * Creates a new filled Buffer instance.
   * alloc(size[, fill[, encoding]])
   **/
  Buffer.alloc = function (size, fill, encoding) {
    return alloc(size, fill, encoding)
  }
  
  function allocUnsafe (size) {
    assertSize(size)
    return createBuffer(size < 0 ? 0 : checked(size) | 0)
  }
  
  /**
   * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
   * */
  Buffer.allocUnsafe = function (size) {
    return allocUnsafe(size)
  }
  /**
   * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
   */
  Buffer.allocUnsafeSlow = function (size) {
    return allocUnsafe(size)
  }
  
  function fromString (string, encoding) {
    if (typeof encoding !== 'string' || encoding === '') {
      encoding = 'utf8'
    }
  
    if (!Buffer.isEncoding(encoding)) {
      throw new TypeError('Unknown encoding: ' + encoding)
    }
  
    var length = byteLength(string, encoding) | 0
    var buf = createBuffer(length)
  
    var actual = buf.write(string, encoding)
  
    if (actual !== length) {
      // Writing a hex string, for example, that contains invalid characters will
      // cause everything after the first invalid character to be ignored. (e.g.
      // 'abxxcd' will be treated as 'ab')
      buf = buf.slice(0, actual)
    }
  
    return buf
  }
  
  function fromArrayLike (array) {
    var length = array.length < 0 ? 0 : checked(array.length) | 0
    var buf = createBuffer(length)
    for (var i = 0; i < length; i += 1) {
      buf[i] = array[i] & 255
    }
    return buf
  }
  
  function fromArrayBuffer (array, byteOffset, length) {
    if (byteOffset < 0 || array.byteLength < byteOffset) {
      throw new RangeError('"offset" is outside of buffer bounds')
    }
  
    if (array.byteLength < byteOffset + (length || 0)) {
      throw new RangeError('"length" is outside of buffer bounds')
    }
  
    var buf
    if (byteOffset === undefined && length === undefined) {
      buf = new Uint8Array(array)
    } else if (length === undefined) {
      buf = new Uint8Array(array, byteOffset)
    } else {
      buf = new Uint8Array(array, byteOffset, length)
    }
  
    // Return an augmented `Uint8Array` instance
    buf.__proto__ = Buffer.prototype
    return buf
  }
  
  function fromObject (obj) {
    if (Buffer.isBuffer(obj)) {
      var len = checked(obj.length) | 0
      var buf = createBuffer(len)
  
      if (buf.length === 0) {
        return buf
      }
  
      obj.copy(buf, 0, 0, len)
      return buf
    }
  
    if (obj.length !== undefined) {
      if (typeof obj.length !== 'number' || numberIsNaN(obj.length)) {
        return createBuffer(0)
      }
      return fromArrayLike(obj)
    }
  
    if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
      return fromArrayLike(obj.data)
    }
  }
  
  function checked (length) {
    // Note: cannot use `length < K_MAX_LENGTH` here because that fails when
    // length is NaN (which is otherwise coerced to zero.)
    if (length >= K_MAX_LENGTH) {
      throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                           'size: 0x' + K_MAX_LENGTH.toString(16) + ' bytes')
    }
    return length | 0
  }
  
  function SlowBuffer (length) {
    if (+length != length) { // eslint-disable-line eqeqeq
      length = 0
    }
    return Buffer.alloc(+length)
  }
  
  Buffer.isBuffer = function isBuffer (b) {
    return b != null && b._isBuffer === true &&
      b !== Buffer.prototype // so Buffer.isBuffer(Buffer.prototype) will be false
  }
  
  Buffer.compare = function compare (a, b) {
    if (isInstance(a, Uint8Array)) a = Buffer.from(a, a.offset, a.byteLength)
    if (isInstance(b, Uint8Array)) b = Buffer.from(b, b.offset, b.byteLength)
    if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
      throw new TypeError(
        'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
      )
    }
  
    if (a === b) return 0
  
    var x = a.length
    var y = b.length
  
    for (var i = 0, len = Math.min(x, y); i < len; ++i) {
      if (a[i] !== b[i]) {
        x = a[i]
        y = b[i]
        break
      }
    }
  
    if (x < y) return -1
    if (y < x) return 1
    return 0
  }
  
  Buffer.isEncoding = function isEncoding (encoding) {
    switch (String(encoding).toLowerCase()) {
      case 'hex':
      case 'utf8':
      case 'utf-8':
      case 'ascii':
      case 'latin1':
      case 'binary':
      case 'base64':
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return true
      default:
        return false
    }
  }
  
  Buffer.concat = function concat (list, length) {
    if (!Array.isArray(list)) {
      throw new TypeError('"list" argument must be an Array of Buffers')
    }
  
    if (list.length === 0) {
      return Buffer.alloc(0)
    }
  
    var i
    if (length === undefined) {
      length = 0
      for (i = 0; i < list.length; ++i) {
        length += list[i].length
      }
    }
  
    var buffer = Buffer.allocUnsafe(length)
    var pos = 0
    for (i = 0; i < list.length; ++i) {
      var buf = list[i]
      if (isInstance(buf, Uint8Array)) {
        buf = Buffer.from(buf)
      }
      if (!Buffer.isBuffer(buf)) {
        throw new TypeError('"list" argument must be an Array of Buffers')
      }
      buf.copy(buffer, pos)
      pos += buf.length
    }
    return buffer
  }
  
  function byteLength (string, encoding) {
    if (Buffer.isBuffer(string)) {
      return string.length
    }
    if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
      return string.byteLength
    }
    if (typeof string !== 'string') {
      throw new TypeError(
        'The "string" argument must be one of type string, Buffer, or ArrayBuffer. ' +
        'Received type ' + typeof string
      )
    }
  
    var len = string.length
    var mustMatch = (arguments.length > 2 && arguments[2] === true)
    if (!mustMatch && len === 0) return 0
  
    // Use a for loop to avoid recursion
    var loweredCase = false
    for (;;) {
      switch (encoding) {
        case 'ascii':
        case 'latin1':
        case 'binary':
          return len
        case 'utf8':
        case 'utf-8':
          return utf8ToBytes(string).length
        case 'ucs2':
        case 'ucs-2':
        case 'utf16le':
        case 'utf-16le':
          return len * 2
        case 'hex':
          return len >>> 1
        case 'base64':
          return base64ToBytes(string).length
        default:
          if (loweredCase) {
            return mustMatch ? -1 : utf8ToBytes(string).length // assume utf8
          }
          encoding = ('' + encoding).toLowerCase()
          loweredCase = true
      }
    }
  }
  Buffer.byteLength = byteLength
  
  function slowToString (encoding, start, end) {
    var loweredCase = false
  
    // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
    // property of a typed array.
  
    // This behaves neither like String nor Uint8Array in that we set start/end
    // to their upper/lower bounds if the value passed is out of range.
    // undefined is handled specially as per ECMA-262 6th Edition,
    // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
    if (start === undefined || start < 0) {
      start = 0
    }
    // Return early if start > this.length. Done here to prevent potential uint32
    // coercion fail below.
    if (start > this.length) {
      return ''
    }
  
    if (end === undefined || end > this.length) {
      end = this.length
    }
  
    if (end <= 0) {
      return ''
    }
  
    // Force coersion to uint32. This will also coerce falsey/NaN values to 0.
    end >>>= 0
    start >>>= 0
  
    if (end <= start) {
      return ''
    }
  
    if (!encoding) encoding = 'utf8'
  
    while (true) {
      switch (encoding) {
        case 'hex':
          return hexSlice(this, start, end)
  
        case 'utf8':
        case 'utf-8':
          return utf8Slice(this, start, end)
  
        case 'ascii':
          return asciiSlice(this, start, end)
  
        case 'latin1':
        case 'binary':
          return latin1Slice(this, start, end)
  
        case 'base64':
          return base64Slice(this, start, end)
  
        case 'ucs2':
        case 'ucs-2':
        case 'utf16le':
        case 'utf-16le':
          return utf16leSlice(this, start, end)
  
        default:
          if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
          encoding = (encoding + '').toLowerCase()
          loweredCase = true
      }
    }
  }
  
  // This property is used by `Buffer.isBuffer` (and the `is-buffer` npm package)
  // to detect a Buffer instance. It's not possible to use `instanceof Buffer`
  // reliably in a browserify context because there could be multiple different
  // copies of the 'buffer' package in use. This method works even for Buffer
  // instances that were created from another copy of the `buffer` package.
  // See: https://github.com/feross/buffer/issues/154
  Buffer.prototype._isBuffer = true
  
  function swap (b, n, m) {
    var i = b[n]
    b[n] = b[m]
    b[m] = i
  }
  
  Buffer.prototype.swap16 = function swap16 () {
    var len = this.length
    if (len % 2 !== 0) {
      throw new RangeError('Buffer size must be a multiple of 16-bits')
    }
    for (var i = 0; i < len; i += 2) {
      swap(this, i, i + 1)
    }
    return this
  }
  
  Buffer.prototype.swap32 = function swap32 () {
    var len = this.length
    if (len % 4 !== 0) {
      throw new RangeError('Buffer size must be a multiple of 32-bits')
    }
    for (var i = 0; i < len; i += 4) {
      swap(this, i, i + 3)
      swap(this, i + 1, i + 2)
    }
    return this
  }
  
  Buffer.prototype.swap64 = function swap64 () {
    var len = this.length
    if (len % 8 !== 0) {
      throw new RangeError('Buffer size must be a multiple of 64-bits')
    }
    for (var i = 0; i < len; i += 8) {
      swap(this, i, i + 7)
      swap(this, i + 1, i + 6)
      swap(this, i + 2, i + 5)
      swap(this, i + 3, i + 4)
    }
    return this
  }
  
  Buffer.prototype.toString = function toString () {
    var length = this.length
    if (length === 0) return ''
    if (arguments.length === 0) return utf8Slice(this, 0, length)
    return slowToString.apply(this, arguments)
  }
  
  Buffer.prototype.toLocaleString = Buffer.prototype.toString
  
  Buffer.prototype.equals = function equals (b) {
    if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
    if (this === b) return true
    return Buffer.compare(this, b) === 0
  }
  
  Buffer.prototype.inspect = function inspect () {
    var str = ''
    var max = exports.INSPECT_MAX_BYTES
    str = this.toString('hex', 0, max).replace(/(.{2})/g, '$1 ').trim()
    if (this.length > max) str += ' ... '
    return '<Buffer ' + str + '>'
  }
  
  Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
    if (isInstance(target, Uint8Array)) {
      target = Buffer.from(target, target.offset, target.byteLength)
    }
    if (!Buffer.isBuffer(target)) {
      throw new TypeError(
        'The "target" argument must be one of type Buffer or Uint8Array. ' +
        'Received type ' + (typeof target)
      )
    }
  
    if (start === undefined) {
      start = 0
    }
    if (end === undefined) {
      end = target ? target.length : 0
    }
    if (thisStart === undefined) {
      thisStart = 0
    }
    if (thisEnd === undefined) {
      thisEnd = this.length
    }
  
    if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
      throw new RangeError('out of range index')
    }
  
    if (thisStart >= thisEnd && start >= end) {
      return 0
    }
    if (thisStart >= thisEnd) {
      return -1
    }
    if (start >= end) {
      return 1
    }
  
    start >>>= 0
    end >>>= 0
    thisStart >>>= 0
    thisEnd >>>= 0
  
    if (this === target) return 0
  
    var x = thisEnd - thisStart
    var y = end - start
    var len = Math.min(x, y)
  
    var thisCopy = this.slice(thisStart, thisEnd)
    var targetCopy = target.slice(start, end)
  
    for (var i = 0; i < len; ++i) {
      if (thisCopy[i] !== targetCopy[i]) {
        x = thisCopy[i]
        y = targetCopy[i]
        break
      }
    }
  
    if (x < y) return -1
    if (y < x) return 1
    return 0
  }
  
  // Finds either the first index of `val` in `buffer` at offset >= `byteOffset`,
  // OR the last index of `val` in `buffer` at offset <= `byteOffset`.
  //
  // Arguments:
  // - buffer - a Buffer to search
  // - val - a string, Buffer, or number
  // - byteOffset - an index into `buffer`; will be clamped to an int32
  // - encoding - an optional encoding, relevant is val is a string
  // - dir - true for indexOf, false for lastIndexOf
  function bidirectionalIndexOf (buffer, val, byteOffset, encoding, dir) {
    // Empty buffer means no match
    if (buffer.length === 0) return -1
  
    // Normalize byteOffset
    if (typeof byteOffset === 'string') {
      encoding = byteOffset
      byteOffset = 0
    } else if (byteOffset > 0x7fffffff) {
      byteOffset = 0x7fffffff
    } else if (byteOffset < -0x80000000) {
      byteOffset = -0x80000000
    }
    byteOffset = +byteOffset // Coerce to Number.
    if (numberIsNaN(byteOffset)) {
      // byteOffset: it it's undefined, null, NaN, "foo", etc, search whole buffer
      byteOffset = dir ? 0 : (buffer.length - 1)
    }
  
    // Normalize byteOffset: negative offsets start from the end of the buffer
    if (byteOffset < 0) byteOffset = buffer.length + byteOffset
    if (byteOffset >= buffer.length) {
      if (dir) return -1
      else byteOffset = buffer.length - 1
    } else if (byteOffset < 0) {
      if (dir) byteOffset = 0
      else return -1
    }
  
    // Normalize val
    if (typeof val === 'string') {
      val = Buffer.from(val, encoding)
    }
  
    // Finally, search either indexOf (if dir is true) or lastIndexOf
    if (Buffer.isBuffer(val)) {
      // Special case: looking for empty string/buffer always fails
      if (val.length === 0) {
        return -1
      }
      return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
    } else if (typeof val === 'number') {
      val = val & 0xFF // Search for a byte value [0-255]
      if (typeof Uint8Array.prototype.indexOf === 'function') {
        if (dir) {
          return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
        } else {
          return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
        }
      }
      return arrayIndexOf(buffer, [ val ], byteOffset, encoding, dir)
    }
  
    throw new TypeError('val must be string, number or Buffer')
  }
  
  function arrayIndexOf (arr, val, byteOffset, encoding, dir) {
    var indexSize = 1
    var arrLength = arr.length
    var valLength = val.length
  
    if (encoding !== undefined) {
      encoding = String(encoding).toLowerCase()
      if (encoding === 'ucs2' || encoding === 'ucs-2' ||
          encoding === 'utf16le' || encoding === 'utf-16le') {
        if (arr.length < 2 || val.length < 2) {
          return -1
        }
        indexSize = 2
        arrLength /= 2
        valLength /= 2
        byteOffset /= 2
      }
    }
  
    function read (buf, i) {
      if (indexSize === 1) {
        return buf[i]
      } else {
        return buf.readUInt16BE(i * indexSize)
      }
    }
  
    var i
    if (dir) {
      var foundIndex = -1
      for (i = byteOffset; i < arrLength; i++) {
        if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
          if (foundIndex === -1) foundIndex = i
          if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
        } else {
          if (foundIndex !== -1) i -= i - foundIndex
          foundIndex = -1
        }
      }
    } else {
      if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength
      for (i = byteOffset; i >= 0; i--) {
        var found = true
        for (var j = 0; j < valLength; j++) {
          if (read(arr, i + j) !== read(val, j)) {
            found = false
            break
          }
        }
        if (found) return i
      }
    }
  
    return -1
  }
  
  Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
    return this.indexOf(val, byteOffset, encoding) !== -1
  }
  
  Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
    return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
  }
  
  Buffer.prototype.lastIndexOf = function lastIndexOf (val, byteOffset, encoding) {
    return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
  }
  
  function hexWrite (buf, string, offset, length) {
    offset = Number(offset) || 0
    var remaining = buf.length - offset
    if (!length) {
      length = remaining
    } else {
      length = Number(length)
      if (length > remaining) {
        length = remaining
      }
    }
  
    var strLen = string.length
  
    if (length > strLen / 2) {
      length = strLen / 2
    }
    for (var i = 0; i < length; ++i) {
      var parsed = parseInt(string.substr(i * 2, 2), 16)
      if (numberIsNaN(parsed)) return i
      buf[offset + i] = parsed
    }
    return i
  }
  
  function utf8Write (buf, string, offset, length) {
    return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
  }
  
  function asciiWrite (buf, string, offset, length) {
    return blitBuffer(asciiToBytes(string), buf, offset, length)
  }
  
  function latin1Write (buf, string, offset, length) {
    return asciiWrite(buf, string, offset, length)
  }
  
  function base64Write (buf, string, offset, length) {
    return blitBuffer(base64ToBytes(string), buf, offset, length)
  }
  
  function ucs2Write (buf, string, offset, length) {
    return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
  }
  
  Buffer.prototype.write = function write (string, offset, length, encoding) {
    // Buffer#write(string)
    if (offset === undefined) {
      encoding = 'utf8'
      length = this.length
      offset = 0
    // Buffer#write(string, encoding)
    } else if (length === undefined && typeof offset === 'string') {
      encoding = offset
      length = this.length
      offset = 0
    // Buffer#write(string, offset[, length][, encoding])
    } else if (isFinite(offset)) {
      offset = offset >>> 0
      if (isFinite(length)) {
        length = length >>> 0
        if (encoding === undefined) encoding = 'utf8'
      } else {
        encoding = length
        length = undefined
      }
    } else {
      throw new Error(
        'Buffer.write(string, encoding, offset[, length]) is no longer supported'
      )
    }
  
    var remaining = this.length - offset
    if (length === undefined || length > remaining) length = remaining
  
    if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
      throw new RangeError('Attempt to write outside buffer bounds')
    }
  
    if (!encoding) encoding = 'utf8'
  
    var loweredCase = false
    for (;;) {
      switch (encoding) {
        case 'hex':
          return hexWrite(this, string, offset, length)
  
        case 'utf8':
        case 'utf-8':
          return utf8Write(this, string, offset, length)
  
        case 'ascii':
          return asciiWrite(this, string, offset, length)
  
        case 'latin1':
        case 'binary':
          return latin1Write(this, string, offset, length)
  
        case 'base64':
          // Warning: maxLength not taken into account in base64Write
          return base64Write(this, string, offset, length)
  
        case 'ucs2':
        case 'ucs-2':
        case 'utf16le':
        case 'utf-16le':
          return ucs2Write(this, string, offset, length)
  
        default:
          if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
          encoding = ('' + encoding).toLowerCase()
          loweredCase = true
      }
    }
  }
  
  Buffer.prototype.toJSON = function toJSON () {
    return {
      type: 'Buffer',
      data: Array.prototype.slice.call(this._arr || this, 0)
    }
  }
  
  function base64Slice (buf, start, end) {
    if (start === 0 && end === buf.length) {
      return base64.fromByteArray(buf)
    } else {
      return base64.fromByteArray(buf.slice(start, end))
    }
  }
  
  function utf8Slice (buf, start, end) {
    end = Math.min(buf.length, end)
    var res = []
  
    var i = start
    while (i < end) {
      var firstByte = buf[i]
      var codePoint = null
      var bytesPerSequence = (firstByte > 0xEF) ? 4
        : (firstByte > 0xDF) ? 3
          : (firstByte > 0xBF) ? 2
            : 1
  
      if (i + bytesPerSequence <= end) {
        var secondByte, thirdByte, fourthByte, tempCodePoint
  
        switch (bytesPerSequence) {
          case 1:
            if (firstByte < 0x80) {
              codePoint = firstByte
            }
            break
          case 2:
            secondByte = buf[i + 1]
            if ((secondByte & 0xC0) === 0x80) {
              tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
              if (tempCodePoint > 0x7F) {
                codePoint = tempCodePoint
              }
            }
            break
          case 3:
            secondByte = buf[i + 1]
            thirdByte = buf[i + 2]
            if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
              tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
              if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
                codePoint = tempCodePoint
              }
            }
            break
          case 4:
            secondByte = buf[i + 1]
            thirdByte = buf[i + 2]
            fourthByte = buf[i + 3]
            if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
              tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
              if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
                codePoint = tempCodePoint
              }
            }
        }
      }
  
      if (codePoint === null) {
        // we did not generate a valid codePoint so insert a
        // replacement char (U+FFFD) and advance only 1 byte
        codePoint = 0xFFFD
        bytesPerSequence = 1
      } else if (codePoint > 0xFFFF) {
        // encode to utf16 (surrogate pair dance)
        codePoint -= 0x10000
        res.push(codePoint >>> 10 & 0x3FF | 0xD800)
        codePoint = 0xDC00 | codePoint & 0x3FF
      }
  
      res.push(codePoint)
      i += bytesPerSequence
    }
  
    return decodeCodePointsArray(res)
  }
  
  // Based on http://stackoverflow.com/a/22747272/680742, the browser with
  // the lowest limit is Chrome, with 0x10000 args.
  // We go 1 magnitude less, for safety
  var MAX_ARGUMENTS_LENGTH = 0x1000
  
  function decodeCodePointsArray (codePoints) {
    var len = codePoints.length
    if (len <= MAX_ARGUMENTS_LENGTH) {
      return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
    }
  
    // Decode in chunks to avoid "call stack size exceeded".
    var res = ''
    var i = 0
    while (i < len) {
      res += String.fromCharCode.apply(
        String,
        codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
      )
    }
    return res
  }
  
  function asciiSlice (buf, start, end) {
    var ret = ''
    end = Math.min(buf.length, end)
  
    for (var i = start; i < end; ++i) {
      ret += String.fromCharCode(buf[i] & 0x7F)
    }
    return ret
  }
  
  function latin1Slice (buf, start, end) {
    var ret = ''
    end = Math.min(buf.length, end)
  
    for (var i = start; i < end; ++i) {
      ret += String.fromCharCode(buf[i])
    }
    return ret
  }
  
  function hexSlice (buf, start, end) {
    var len = buf.length
  
    if (!start || start < 0) start = 0
    if (!end || end < 0 || end > len) end = len
  
    var out = ''
    for (var i = start; i < end; ++i) {
      out += toHex(buf[i])
    }
    return out
  }
  
  function utf16leSlice (buf, start, end) {
    var bytes = buf.slice(start, end)
    var res = ''
    for (var i = 0; i < bytes.length; i += 2) {
      res += String.fromCharCode(bytes[i] + (bytes[i + 1] * 256))
    }
    return res
  }
  
  Buffer.prototype.slice = function slice (start, end) {
    var len = this.length
    start = ~~start
    end = end === undefined ? len : ~~end
  
    if (start < 0) {
      start += len
      if (start < 0) start = 0
    } else if (start > len) {
      start = len
    }
  
    if (end < 0) {
      end += len
      if (end < 0) end = 0
    } else if (end > len) {
      end = len
    }
  
    if (end < start) end = start
  
    var newBuf = this.subarray(start, end)
    // Return an augmented `Uint8Array` instance
    newBuf.__proto__ = Buffer.prototype
    return newBuf
  }
  
  /*
   * Need to make sure that buffer isn't trying to write out of bounds.
   */
  function checkOffset (offset, ext, length) {
    if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
    if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
  }
  
  Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
    offset = offset >>> 0
    byteLength = byteLength >>> 0
    if (!noAssert) checkOffset(offset, byteLength, this.length)
  
    var val = this[offset]
    var mul = 1
    var i = 0
    while (++i < byteLength && (mul *= 0x100)) {
      val += this[offset + i] * mul
    }
  
    return val
  }
  
  Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
    offset = offset >>> 0
    byteLength = byteLength >>> 0
    if (!noAssert) {
      checkOffset(offset, byteLength, this.length)
    }
  
    var val = this[offset + --byteLength]
    var mul = 1
    while (byteLength > 0 && (mul *= 0x100)) {
      val += this[offset + --byteLength] * mul
    }
  
    return val
  }
  
  Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
    offset = offset >>> 0
    if (!noAssert) checkOffset(offset, 1, this.length)
    return this[offset]
  }
  
  Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
    offset = offset >>> 0
    if (!noAssert) checkOffset(offset, 2, this.length)
    return this[offset] | (this[offset + 1] << 8)
  }
  
  Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
    offset = offset >>> 0
    if (!noAssert) checkOffset(offset, 2, this.length)
    return (this[offset] << 8) | this[offset + 1]
  }
  
  Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
    offset = offset >>> 0
    if (!noAssert) checkOffset(offset, 4, this.length)
  
    return ((this[offset]) |
        (this[offset + 1] << 8) |
        (this[offset + 2] << 16)) +
        (this[offset + 3] * 0x1000000)
  }
  
  Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
    offset = offset >>> 0
    if (!noAssert) checkOffset(offset, 4, this.length)
  
    return (this[offset] * 0x1000000) +
      ((this[offset + 1] << 16) |
      (this[offset + 2] << 8) |
      this[offset + 3])
  }
  
  Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
    offset = offset >>> 0
    byteLength = byteLength >>> 0
    if (!noAssert) checkOffset(offset, byteLength, this.length)
  
    var val = this[offset]
    var mul = 1
    var i = 0
    while (++i < byteLength && (mul *= 0x100)) {
      val += this[offset + i] * mul
    }
    mul *= 0x80
  
    if (val >= mul) val -= Math.pow(2, 8 * byteLength)
  
    return val
  }
  
  Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
    offset = offset >>> 0
    byteLength = byteLength >>> 0
    if (!noAssert) checkOffset(offset, byteLength, this.length)
  
    var i = byteLength
    var mul = 1
    var val = this[offset + --i]
    while (i > 0 && (mul *= 0x100)) {
      val += this[offset + --i] * mul
    }
    mul *= 0x80
  
    if (val >= mul) val -= Math.pow(2, 8 * byteLength)
  
    return val
  }
  
  Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
    offset = offset >>> 0
    if (!noAssert) checkOffset(offset, 1, this.length)
    if (!(this[offset] & 0x80)) return (this[offset])
    return ((0xff - this[offset] + 1) * -1)
  }
  
  Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
    offset = offset >>> 0
    if (!noAssert) checkOffset(offset, 2, this.length)
    var val = this[offset] | (this[offset + 1] << 8)
    return (val & 0x8000) ? val | 0xFFFF0000 : val
  }
  
  Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
    offset = offset >>> 0
    if (!noAssert) checkOffset(offset, 2, this.length)
    var val = this[offset + 1] | (this[offset] << 8)
    return (val & 0x8000) ? val | 0xFFFF0000 : val
  }
  
  Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
    offset = offset >>> 0
    if (!noAssert) checkOffset(offset, 4, this.length)
  
    return (this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16) |
      (this[offset + 3] << 24)
  }
  
  Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
    offset = offset >>> 0
    if (!noAssert) checkOffset(offset, 4, this.length)
  
    return (this[offset] << 24) |
      (this[offset + 1] << 16) |
      (this[offset + 2] << 8) |
      (this[offset + 3])
  }
  
  Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
    offset = offset >>> 0
    if (!noAssert) checkOffset(offset, 4, this.length)
    return ieee754.read(this, offset, true, 23, 4)
  }
  
  Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
    offset = offset >>> 0
    if (!noAssert) checkOffset(offset, 4, this.length)
    return ieee754.read(this, offset, false, 23, 4)
  }
  
  Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
    offset = offset >>> 0
    if (!noAssert) checkOffset(offset, 8, this.length)
    return ieee754.read(this, offset, true, 52, 8)
  }
  
  Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
    offset = offset >>> 0
    if (!noAssert) checkOffset(offset, 8, this.length)
    return ieee754.read(this, offset, false, 52, 8)
  }
  
  function checkInt (buf, value, offset, ext, max, min) {
    if (!Buffer.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance')
    if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
    if (offset + ext > buf.length) throw new RangeError('Index out of range')
  }
  
  Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
    value = +value
    offset = offset >>> 0
    byteLength = byteLength >>> 0
    if (!noAssert) {
      var maxBytes = Math.pow(2, 8 * byteLength) - 1
      checkInt(this, value, offset, byteLength, maxBytes, 0)
    }
  
    var mul = 1
    var i = 0
    this[offset] = value & 0xFF
    while (++i < byteLength && (mul *= 0x100)) {
      this[offset + i] = (value / mul) & 0xFF
    }
  
    return offset + byteLength
  }
  
  Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
    value = +value
    offset = offset >>> 0
    byteLength = byteLength >>> 0
    if (!noAssert) {
      var maxBytes = Math.pow(2, 8 * byteLength) - 1
      checkInt(this, value, offset, byteLength, maxBytes, 0)
    }
  
    var i = byteLength - 1
    var mul = 1
    this[offset + i] = value & 0xFF
    while (--i >= 0 && (mul *= 0x100)) {
      this[offset + i] = (value / mul) & 0xFF
    }
  
    return offset + byteLength
  }
  
  Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
    value = +value
    offset = offset >>> 0
    if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
    this[offset] = (value & 0xff)
    return offset + 1
  }
  
  Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
    value = +value
    offset = offset >>> 0
    if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
    return offset + 2
  }
  
  Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
    value = +value
    offset = offset >>> 0
    if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
    return offset + 2
  }
  
  Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
    value = +value
    offset = offset >>> 0
    if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = (value & 0xff)
    return offset + 4
  }
  
  Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
    value = +value
    offset = offset >>> 0
    if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
    return offset + 4
  }
  
  Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
    value = +value
    offset = offset >>> 0
    if (!noAssert) {
      var limit = Math.pow(2, (8 * byteLength) - 1)
  
      checkInt(this, value, offset, byteLength, limit - 1, -limit)
    }
  
    var i = 0
    var mul = 1
    var sub = 0
    this[offset] = value & 0xFF
    while (++i < byteLength && (mul *= 0x100)) {
      if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
        sub = 1
      }
      this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
    }
  
    return offset + byteLength
  }
  
  Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
    value = +value
    offset = offset >>> 0
    if (!noAssert) {
      var limit = Math.pow(2, (8 * byteLength) - 1)
  
      checkInt(this, value, offset, byteLength, limit - 1, -limit)
    }
  
    var i = byteLength - 1
    var mul = 1
    var sub = 0
    this[offset + i] = value & 0xFF
    while (--i >= 0 && (mul *= 0x100)) {
      if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
        sub = 1
      }
      this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
    }
  
    return offset + byteLength
  }
  
  Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
    value = +value
    offset = offset >>> 0
    if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
    if (value < 0) value = 0xff + value + 1
    this[offset] = (value & 0xff)
    return offset + 1
  }
  
  Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
    value = +value
    offset = offset >>> 0
    if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
    return offset + 2
  }
  
  Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
    value = +value
    offset = offset >>> 0
    if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
    return offset + 2
  }
  
  Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
    value = +value
    offset = offset >>> 0
    if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
    return offset + 4
  }
  
  Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
    value = +value
    offset = offset >>> 0
    if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
    if (value < 0) value = 0xffffffff + value + 1
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
    return offset + 4
  }
  
  function checkIEEE754 (buf, value, offset, ext, max, min) {
    if (offset + ext > buf.length) throw new RangeError('Index out of range')
    if (offset < 0) throw new RangeError('Index out of range')
  }
  
  function writeFloat (buf, value, offset, littleEndian, noAssert) {
    value = +value
    offset = offset >>> 0
    if (!noAssert) {
      checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
    }
    ieee754.write(buf, value, offset, littleEndian, 23, 4)
    return offset + 4
  }
  
  Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
    return writeFloat(this, value, offset, true, noAssert)
  }
  
  Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
    return writeFloat(this, value, offset, false, noAssert)
  }
  
  function writeDouble (buf, value, offset, littleEndian, noAssert) {
    value = +value
    offset = offset >>> 0
    if (!noAssert) {
      checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
    }
    ieee754.write(buf, value, offset, littleEndian, 52, 8)
    return offset + 8
  }
  
  Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
    return writeDouble(this, value, offset, true, noAssert)
  }
  
  Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
    return writeDouble(this, value, offset, false, noAssert)
  }
  
  // copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
  Buffer.prototype.copy = function copy (target, targetStart, start, end) {
    if (!Buffer.isBuffer(target)) throw new TypeError('argument should be a Buffer')
    if (!start) start = 0
    if (!end && end !== 0) end = this.length
    if (targetStart >= target.length) targetStart = target.length
    if (!targetStart) targetStart = 0
    if (end > 0 && end < start) end = start
  
    // Copy 0 bytes; we're done
    if (end === start) return 0
    if (target.length === 0 || this.length === 0) return 0
  
    // Fatal error conditions
    if (targetStart < 0) {
      throw new RangeError('targetStart out of bounds')
    }
    if (start < 0 || start >= this.length) throw new RangeError('Index out of range')
    if (end < 0) throw new RangeError('sourceEnd out of bounds')
  
    // Are we oob?
    if (end > this.length) end = this.length
    if (target.length - targetStart < end - start) {
      end = target.length - targetStart + start
    }
  
    var len = end - start
  
    if (this === target && typeof Uint8Array.prototype.copyWithin === 'function') {
      // Use built-in when available, missing from IE11
      this.copyWithin(targetStart, start, end)
    } else if (this === target && start < targetStart && targetStart < end) {
      // descending copy from end
      for (var i = len - 1; i >= 0; --i) {
        target[i + targetStart] = this[i + start]
      }
    } else {
      Uint8Array.prototype.set.call(
        target,
        this.subarray(start, end),
        targetStart
      )
    }
  
    return len
  }
  
  // Usage:
  //    buffer.fill(number[, offset[, end]])
  //    buffer.fill(buffer[, offset[, end]])
  //    buffer.fill(string[, offset[, end]][, encoding])
  Buffer.prototype.fill = function fill (val, start, end, encoding) {
    // Handle string cases:
    if (typeof val === 'string') {
      if (typeof start === 'string') {
        encoding = start
        start = 0
        end = this.length
      } else if (typeof end === 'string') {
        encoding = end
        end = this.length
      }
      if (encoding !== undefined && typeof encoding !== 'string') {
        throw new TypeError('encoding must be a string')
      }
      if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
        throw new TypeError('Unknown encoding: ' + encoding)
      }
      if (val.length === 1) {
        var code = val.charCodeAt(0)
        if ((encoding === 'utf8' && code < 128) ||
            encoding === 'latin1') {
          // Fast path: If `val` fits into a single byte, use that numeric value.
          val = code
        }
      }
    } else if (typeof val === 'number') {
      val = val & 255
    }
  
    // Invalid ranges are not set to a default, so can range check early.
    if (start < 0 || this.length < start || this.length < end) {
      throw new RangeError('Out of range index')
    }
  
    if (end <= start) {
      return this
    }
  
    start = start >>> 0
    end = end === undefined ? this.length : end >>> 0
  
    if (!val) val = 0
  
    var i
    if (typeof val === 'number') {
      for (i = start; i < end; ++i) {
        this[i] = val
      }
    } else {
      var bytes = Buffer.isBuffer(val)
        ? val
        : Buffer.from(val, encoding)
      var len = bytes.length
      if (len === 0) {
        throw new TypeError('The value "' + val +
          '" is invalid for argument "value"')
      }
      for (i = 0; i < end - start; ++i) {
        this[i + start] = bytes[i % len]
      }
    }
  
    return this
  }
  
  // HELPER FUNCTIONS
  // ================
  
  var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g
  
  function base64clean (str) {
    // Node takes equal signs as end of the Base64 encoding
    str = str.split('=')[0]
    // Node strips out invalid characters like \n and \t from the string, base64-js does not
    str = str.trim().replace(INVALID_BASE64_RE, '')
    // Node converts strings with length < 2 to ''
    if (str.length < 2) return ''
    // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
    while (str.length % 4 !== 0) {
      str = str + '='
    }
    return str
  }
  
  function toHex (n) {
    if (n < 16) return '0' + n.toString(16)
    return n.toString(16)
  }
  
  function utf8ToBytes (string, units) {
    units = units || Infinity
    var codePoint
    var length = string.length
    var leadSurrogate = null
    var bytes = []
  
    for (var i = 0; i < length; ++i) {
      codePoint = string.charCodeAt(i)
  
      // is surrogate component
      if (codePoint > 0xD7FF && codePoint < 0xE000) {
        // last char was a lead
        if (!leadSurrogate) {
          // no lead yet
          if (codePoint > 0xDBFF) {
            // unexpected trail
            if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
            continue
          } else if (i + 1 === length) {
            // unpaired lead
            if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
            continue
          }
  
          // valid lead
          leadSurrogate = codePoint
  
          continue
        }
  
        // 2 leads in a row
        if (codePoint < 0xDC00) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          leadSurrogate = codePoint
          continue
        }
  
        // valid surrogate pair
        codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
      } else if (leadSurrogate) {
        // valid bmp char, but last char was a lead
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
      }
  
      leadSurrogate = null
  
      // encode utf8
      if (codePoint < 0x80) {
        if ((units -= 1) < 0) break
        bytes.push(codePoint)
      } else if (codePoint < 0x800) {
        if ((units -= 2) < 0) break
        bytes.push(
          codePoint >> 0x6 | 0xC0,
          codePoint & 0x3F | 0x80
        )
      } else if (codePoint < 0x10000) {
        if ((units -= 3) < 0) break
        bytes.push(
          codePoint >> 0xC | 0xE0,
          codePoint >> 0x6 & 0x3F | 0x80,
          codePoint & 0x3F | 0x80
        )
      } else if (codePoint < 0x110000) {
        if ((units -= 4) < 0) break
        bytes.push(
          codePoint >> 0x12 | 0xF0,
          codePoint >> 0xC & 0x3F | 0x80,
          codePoint >> 0x6 & 0x3F | 0x80,
          codePoint & 0x3F | 0x80
        )
      } else {
        throw new Error('Invalid code point')
      }
    }
  
    return bytes
  }
  
  function asciiToBytes (str) {
    var byteArray = []
    for (var i = 0; i < str.length; ++i) {
      // Node's code seems to be doing this and not & 0x7F..
      byteArray.push(str.charCodeAt(i) & 0xFF)
    }
    return byteArray
  }
  
  function utf16leToBytes (str, units) {
    var c, hi, lo
    var byteArray = []
    for (var i = 0; i < str.length; ++i) {
      if ((units -= 2) < 0) break
  
      c = str.charCodeAt(i)
      hi = c >> 8
      lo = c % 256
      byteArray.push(lo)
      byteArray.push(hi)
    }
  
    return byteArray
  }
  
  function base64ToBytes (str) {
    return base64.toByteArray(base64clean(str))
  }
  
  function blitBuffer (src, dst, offset, length) {
    for (var i = 0; i < length; ++i) {
      if ((i + offset >= dst.length) || (i >= src.length)) break
      dst[i + offset] = src[i]
    }
    return i
  }
  
  // ArrayBuffer or Uint8Array objects from other contexts (i.e. iframes) do not pass
  // the `instanceof` check but they should be treated as of that type.
  // See: https://github.com/feross/buffer/issues/166
  function isInstance (obj, type) {
    return obj instanceof type ||
      (obj != null && obj.constructor != null && obj.constructor.name != null &&
        obj.constructor.name === type.name)
  }
  function numberIsNaN (obj) {
    // For IE11 support
    return obj !== obj // eslint-disable-line no-self-compare
  }
  
  }).call(this)}).call(this,require("buffer").Buffer)
  },{"base64-js":1,"buffer":3,"ieee754":7}],4:[function(require,module,exports){
  module.exports = {
    "100": "Continue",
    "101": "Switching Protocols",
    "102": "Processing",
    "200": "OK",
    "201": "Created",
    "202": "Accepted",
    "203": "Non-Authoritative Information",
    "204": "No Content",
    "205": "Reset Content",
    "206": "Partial Content",
    "207": "Multi-Status",
    "208": "Already Reported",
    "226": "IM Used",
    "300": "Multiple Choices",
    "301": "Moved Permanently",
    "302": "Found",
    "303": "See Other",
    "304": "Not Modified",
    "305": "Use Proxy",
    "307": "Temporary Redirect",
    "308": "Permanent Redirect",
    "400": "Bad Request",
    "401": "Unauthorized",
    "402": "Payment Required",
    "403": "Forbidden",
    "404": "Not Found",
    "405": "Method Not Allowed",
    "406": "Not Acceptable",
    "407": "Proxy Authentication Required",
    "408": "Request Timeout",
    "409": "Conflict",
    "410": "Gone",
    "411": "Length Required",
    "412": "Precondition Failed",
    "413": "Payload Too Large",
    "414": "URI Too Long",
    "415": "Unsupported Media Type",
    "416": "Range Not Satisfiable",
    "417": "Expectation Failed",
    "418": "I'm a teapot",
    "421": "Misdirected Request",
    "422": "Unprocessable Entity",
    "423": "Locked",
    "424": "Failed Dependency",
    "425": "Unordered Collection",
    "426": "Upgrade Required",
    "428": "Precondition Required",
    "429": "Too Many Requests",
    "431": "Request Header Fields Too Large",
    "451": "Unavailable For Legal Reasons",
    "500": "Internal Server Error",
    "501": "Not Implemented",
    "502": "Bad Gateway",
    "503": "Service Unavailable",
    "504": "Gateway Timeout",
    "505": "HTTP Version Not Supported",
    "506": "Variant Also Negotiates",
    "507": "Insufficient Storage",
    "508": "Loop Detected",
    "509": "Bandwidth Limit Exceeded",
    "510": "Not Extended",
    "511": "Network Authentication Required"
  }
  
  },{}],5:[function(require,module,exports){
  // Copyright Joyent, Inc. and other Node contributors.
  //
  // Permission is hereby granted, free of charge, to any person obtaining a
  // copy of this software and associated documentation files (the
  // "Software"), to deal in the Software without restriction, including
  // without limitation the rights to use, copy, modify, merge, publish,
  // distribute, sublicense, and/or sell copies of the Software, and to permit
  // persons to whom the Software is furnished to do so, subject to the
  // following conditions:
  //
  // The above copyright notice and this permission notice shall be included
  // in all copies or substantial portions of the Software.
  //
  // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
  // OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  // MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
  // NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
  // DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  // OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
  // USE OR OTHER DEALINGS IN THE SOFTWARE.
  
  'use strict';
  
  var R = typeof Reflect === 'object' ? Reflect : null
  var ReflectApply = R && typeof R.apply === 'function'
    ? R.apply
    : function ReflectApply(target, receiver, args) {
      return Function.prototype.apply.call(target, receiver, args);
    }
  
  var ReflectOwnKeys
  if (R && typeof R.ownKeys === 'function') {
    ReflectOwnKeys = R.ownKeys
  } else if (Object.getOwnPropertySymbols) {
    ReflectOwnKeys = function ReflectOwnKeys(target) {
      return Object.getOwnPropertyNames(target)
        .concat(Object.getOwnPropertySymbols(target));
    };
  } else {
    ReflectOwnKeys = function ReflectOwnKeys(target) {
      return Object.getOwnPropertyNames(target);
    };
  }
  
  function ProcessEmitWarning(warning) {
    if (console && console.warn) console.warn(warning);
  }
  
  var NumberIsNaN = Number.isNaN || function NumberIsNaN(value) {
    return value !== value;
  }
  
  function EventEmitter() {
    EventEmitter.init.call(this);
  }
  module.exports = EventEmitter;
  module.exports.once = once;
  
  // Backwards-compat with node 0.10.x
  EventEmitter.EventEmitter = EventEmitter;
  
  EventEmitter.prototype._events = undefined;
  EventEmitter.prototype._eventsCount = 0;
  EventEmitter.prototype._maxListeners = undefined;
  
  // By default EventEmitters will print a warning if more than 10 listeners are
  // added to it. This is a useful default which helps finding memory leaks.
  var defaultMaxListeners = 10;
  
  function checkListener(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
    }
  }
  
  Object.defineProperty(EventEmitter, 'defaultMaxListeners', {
    enumerable: true,
    get: function() {
      return defaultMaxListeners;
    },
    set: function(arg) {
      if (typeof arg !== 'number' || arg < 0 || NumberIsNaN(arg)) {
        throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + arg + '.');
      }
      defaultMaxListeners = arg;
    }
  });
  
  EventEmitter.init = function() {
  
    if (this._events === undefined ||
        this._events === Object.getPrototypeOf(this)._events) {
      this._events = Object.create(null);
      this._eventsCount = 0;
    }
  
    this._maxListeners = this._maxListeners || undefined;
  };
  
  // Obviously not all Emitters should be limited to 10. This function allows
  // that to be increased. Set to zero for unlimited.
  EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
    if (typeof n !== 'number' || n < 0 || NumberIsNaN(n)) {
      throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n + '.');
    }
    this._maxListeners = n;
    return this;
  };
  
  function _getMaxListeners(that) {
    if (that._maxListeners === undefined)
      return EventEmitter.defaultMaxListeners;
    return that._maxListeners;
  }
  
  EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
    return _getMaxListeners(this);
  };
  
  EventEmitter.prototype.emit = function emit(type) {
    var args = [];
    for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
    var doError = (type === 'error');
  
    var events = this._events;
    if (events !== undefined)
      doError = (doError && events.error === undefined);
    else if (!doError)
      return false;
  
    // If there is no 'error' event listener then throw.
    if (doError) {
      var er;
      if (args.length > 0)
        er = args[0];
      if (er instanceof Error) {
        // Note: The comments on the `throw` lines are intentional, they show
        // up in Node's output if this results in an unhandled exception.
        throw er; // Unhandled 'error' event
      }
      // At least give some kind of context to the user
      var err = new Error('Unhandled error.' + (er ? ' (' + er.message + ')' : ''));
      err.context = er;
      throw err; // Unhandled 'error' event
    }
  
    var handler = events[type];
  
    if (handler === undefined)
      return false;
  
    if (typeof handler === 'function') {
      ReflectApply(handler, this, args);
    } else {
      var len = handler.length;
      var listeners = arrayClone(handler, len);
      for (var i = 0; i < len; ++i)
        ReflectApply(listeners[i], this, args);
    }
  
    return true;
  };
  
  function _addListener(target, type, listener, prepend) {
    var m;
    var events;
    var existing;
  
    checkListener(listener);
  
    events = target._events;
    if (events === undefined) {
      events = target._events = Object.create(null);
      target._eventsCount = 0;
    } else {
      // To avoid recursion in the case that type === "newListener"! Before
      // adding it to the listeners, first emit "newListener".
      if (events.newListener !== undefined) {
        target.emit('newListener', type,
                    listener.listener ? listener.listener : listener);
  
        // Re-assign `events` because a newListener handler could have caused the
        // this._events to be assigned to a new object
        events = target._events;
      }
      existing = events[type];
    }
  
    if (existing === undefined) {
      // Optimize the case of one listener. Don't need the extra array object.
      existing = events[type] = listener;
      ++target._eventsCount;
    } else {
      if (typeof existing === 'function') {
        // Adding the second element, need to change to array.
        existing = events[type] =
          prepend ? [listener, existing] : [existing, listener];
        // If we've already got an array, just append.
      } else if (prepend) {
        existing.unshift(listener);
      } else {
        existing.push(listener);
      }
  
      // Check for listener leak
      m = _getMaxListeners(target);
      if (m > 0 && existing.length > m && !existing.warned) {
        existing.warned = true;
        // No error code for this since it is a Warning
        // eslint-disable-next-line no-restricted-syntax
        var w = new Error('Possible EventEmitter memory leak detected. ' +
                            existing.length + ' ' + String(type) + ' listeners ' +
                            'added. Use emitter.setMaxListeners() to ' +
                            'increase limit');
        w.name = 'MaxListenersExceededWarning';
        w.emitter = target;
        w.type = type;
        w.count = existing.length;
        ProcessEmitWarning(w);
      }
    }
  
    return target;
  }
  
  EventEmitter.prototype.addListener = function addListener(type, listener) {
    return _addListener(this, type, listener, false);
  };
  
  EventEmitter.prototype.on = EventEmitter.prototype.addListener;
  
  EventEmitter.prototype.prependListener =
      function prependListener(type, listener) {
        return _addListener(this, type, listener, true);
      };
  
  function onceWrapper() {
    if (!this.fired) {
      this.target.removeListener(this.type, this.wrapFn);
      this.fired = true;
      if (arguments.length === 0)
        return this.listener.call(this.target);
      return this.listener.apply(this.target, arguments);
    }
  }
  
  function _onceWrap(target, type, listener) {
    var state = { fired: false, wrapFn: undefined, target: target, type: type, listener: listener };
    var wrapped = onceWrapper.bind(state);
    wrapped.listener = listener;
    state.wrapFn = wrapped;
    return wrapped;
  }
  
  EventEmitter.prototype.once = function once(type, listener) {
    checkListener(listener);
    this.on(type, _onceWrap(this, type, listener));
    return this;
  };
  
  EventEmitter.prototype.prependOnceListener =
      function prependOnceListener(type, listener) {
        checkListener(listener);
        this.prependListener(type, _onceWrap(this, type, listener));
        return this;
      };
  
  // Emits a 'removeListener' event if and only if the listener was removed.
  EventEmitter.prototype.removeListener =
      function removeListener(type, listener) {
        var list, events, position, i, originalListener;
  
        checkListener(listener);
  
        events = this._events;
        if (events === undefined)
          return this;
  
        list = events[type];
        if (list === undefined)
          return this;
  
        if (list === listener || list.listener === listener) {
          if (--this._eventsCount === 0)
            this._events = Object.create(null);
          else {
            delete events[type];
            if (events.removeListener)
              this.emit('removeListener', type, list.listener || listener);
          }
        } else if (typeof list !== 'function') {
          position = -1;
  
          for (i = list.length - 1; i >= 0; i--) {
            if (list[i] === listener || list[i].listener === listener) {
              originalListener = list[i].listener;
              position = i;
              break;
            }
          }
  
          if (position < 0)
            return this;
  
          if (position === 0)
            list.shift();
          else {
            spliceOne(list, position);
          }
  
          if (list.length === 1)
            events[type] = list[0];
  
          if (events.removeListener !== undefined)
            this.emit('removeListener', type, originalListener || listener);
        }
  
        return this;
      };
  
  EventEmitter.prototype.off = EventEmitter.prototype.removeListener;
  
  EventEmitter.prototype.removeAllListeners =
      function removeAllListeners(type) {
        var listeners, events, i;
  
        events = this._events;
        if (events === undefined)
          return this;
  
        // not listening for removeListener, no need to emit
        if (events.removeListener === undefined) {
          if (arguments.length === 0) {
            this._events = Object.create(null);
            this._eventsCount = 0;
          } else if (events[type] !== undefined) {
            if (--this._eventsCount === 0)
              this._events = Object.create(null);
            else
              delete events[type];
          }
          return this;
        }
  
        // emit removeListener for all listeners on all events
        if (arguments.length === 0) {
          var keys = Object.keys(events);
          var key;
          for (i = 0; i < keys.length; ++i) {
            key = keys[i];
            if (key === 'removeListener') continue;
            this.removeAllListeners(key);
          }
          this.removeAllListeners('removeListener');
          this._events = Object.create(null);
          this._eventsCount = 0;
          return this;
        }
  
        listeners = events[type];
  
        if (typeof listeners === 'function') {
          this.removeListener(type, listeners);
        } else if (listeners !== undefined) {
          // LIFO order
          for (i = listeners.length - 1; i >= 0; i--) {
            this.removeListener(type, listeners[i]);
          }
        }
  
        return this;
      };
  
  function _listeners(target, type, unwrap) {
    var events = target._events;
  
    if (events === undefined)
      return [];
  
    var evlistener = events[type];
    if (evlistener === undefined)
      return [];
  
    if (typeof evlistener === 'function')
      return unwrap ? [evlistener.listener || evlistener] : [evlistener];
  
    return unwrap ?
      unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
  }
  
  EventEmitter.prototype.listeners = function listeners(type) {
    return _listeners(this, type, true);
  };
  
  EventEmitter.prototype.rawListeners = function rawListeners(type) {
    return _listeners(this, type, false);
  };
  
  EventEmitter.listenerCount = function(emitter, type) {
    if (typeof emitter.listenerCount === 'function') {
      return emitter.listenerCount(type);
    } else {
      return listenerCount.call(emitter, type);
    }
  };
  
  EventEmitter.prototype.listenerCount = listenerCount;
  function listenerCount(type) {
    var events = this._events;
  
    if (events !== undefined) {
      var evlistener = events[type];
  
      if (typeof evlistener === 'function') {
        return 1;
      } else if (evlistener !== undefined) {
        return evlistener.length;
      }
    }
  
    return 0;
  }
  
  EventEmitter.prototype.eventNames = function eventNames() {
    return this._eventsCount > 0 ? ReflectOwnKeys(this._events) : [];
  };
  
  function arrayClone(arr, n) {
    var copy = new Array(n);
    for (var i = 0; i < n; ++i)
      copy[i] = arr[i];
    return copy;
  }
  
  function spliceOne(list, index) {
    for (; index + 1 < list.length; index++)
      list[index] = list[index + 1];
    list.pop();
  }
  
  function unwrapListeners(arr) {
    var ret = new Array(arr.length);
    for (var i = 0; i < ret.length; ++i) {
      ret[i] = arr[i].listener || arr[i];
    }
    return ret;
  }
  
  function once(emitter, name) {
    return new Promise(function (resolve, reject) {
      function eventListener() {
        if (errorListener !== undefined) {
          emitter.removeListener('error', errorListener);
        }
        resolve([].slice.call(arguments));
      };
      var errorListener;
  
      // Adding an error listener is not optional because
      // if an error is thrown on an event emitter we cannot
      // guarantee that the actual event we are waiting will
      // be fired. The result could be a silent way to create
      // memory or file descriptor leaks, which is something
      // we should avoid.
      if (name !== 'error') {
        errorListener = function errorListener(err) {
          emitter.removeListener(name, eventListener);
          reject(err);
        };
  
        emitter.once('error', errorListener);
      }
  
      emitter.once(name, eventListener);
    });
  }
  
  },{}],6:[function(require,module,exports){
  var http = require('http')
  var url = require('url')
  
  var https = module.exports
  
  for (var key in http) {
    if (http.hasOwnProperty(key)) https[key] = http[key]
  }
  
  https.request = function (params, cb) {
    params = validateParams(params)
    return http.request.call(this, params, cb)
  }
  
  https.get = function (params, cb) {
    params = validateParams(params)
    return http.get.call(this, params, cb)
  }
  
  function validateParams (params) {
    if (typeof params === 'string') {
      params = url.parse(params)
    }
    if (!params.protocol) {
      params.protocol = 'https:'
    }
    if (params.protocol !== 'https:') {
      throw new Error('Protocol "' + params.protocol + '" not supported. Expected "https:"')
    }
    return params
  }
  
  },{"http":17,"url":37}],7:[function(require,module,exports){
  /*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> */
  exports.read = function (buffer, offset, isLE, mLen, nBytes) {
    var e, m
    var eLen = (nBytes * 8) - mLen - 1
    var eMax = (1 << eLen) - 1
    var eBias = eMax >> 1
    var nBits = -7
    var i = isLE ? (nBytes - 1) : 0
    var d = isLE ? -1 : 1
    var s = buffer[offset + i]
  
    i += d
  
    e = s & ((1 << (-nBits)) - 1)
    s >>= (-nBits)
    nBits += eLen
    for (; nBits > 0; e = (e * 256) + buffer[offset + i], i += d, nBits -= 8) {}
  
    m = e & ((1 << (-nBits)) - 1)
    e >>= (-nBits)
    nBits += mLen
    for (; nBits > 0; m = (m * 256) + buffer[offset + i], i += d, nBits -= 8) {}
  
    if (e === 0) {
      e = 1 - eBias
    } else if (e === eMax) {
      return m ? NaN : ((s ? -1 : 1) * Infinity)
    } else {
      m = m + Math.pow(2, mLen)
      e = e - eBias
    }
    return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
  }
  
  exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
    var e, m, c
    var eLen = (nBytes * 8) - mLen - 1
    var eMax = (1 << eLen) - 1
    var eBias = eMax >> 1
    var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
    var i = isLE ? 0 : (nBytes - 1)
    var d = isLE ? 1 : -1
    var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0
  
    value = Math.abs(value)
  
    if (isNaN(value) || value === Infinity) {
      m = isNaN(value) ? 1 : 0
      e = eMax
    } else {
      e = Math.floor(Math.log(value) / Math.LN2)
      if (value * (c = Math.pow(2, -e)) < 1) {
        e--
        c *= 2
      }
      if (e + eBias >= 1) {
        value += rt / c
      } else {
        value += rt * Math.pow(2, 1 - eBias)
      }
      if (value * c >= 2) {
        e++
        c /= 2
      }
  
      if (e + eBias >= eMax) {
        m = 0
        e = eMax
      } else if (e + eBias >= 1) {
        m = ((value * c) - 1) * Math.pow(2, mLen)
        e = e + eBias
      } else {
        m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
        e = 0
      }
    }
  
    for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}
  
    e = (e << mLen) | m
    eLen += mLen
    for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}
  
    buffer[offset + i - d] |= s * 128
  }
  
  },{}],8:[function(require,module,exports){
  if (typeof Object.create === 'function') {
    // implementation from standard node.js 'util' module
    module.exports = function inherits(ctor, superCtor) {
      if (superCtor) {
        ctor.super_ = superCtor
        ctor.prototype = Object.create(superCtor.prototype, {
          constructor: {
            value: ctor,
            enumerable: false,
            writable: true,
            configurable: true
          }
        })
      }
    };
  } else {
    // old school shim for old browsers
    module.exports = function inherits(ctor, superCtor) {
      if (superCtor) {
        ctor.super_ = superCtor
        var TempCtor = function () {}
        TempCtor.prototype = superCtor.prototype
        ctor.prototype = new TempCtor()
        ctor.prototype.constructor = ctor
      }
    }
  }
  
  },{}],9:[function(require,module,exports){
  exports.endianness = function () { return 'LE' };
  
  exports.hostname = function () {
      if (typeof location !== 'undefined') {
          return location.hostname
      }
      else return '';
  };
  
  exports.loadavg = function () { return [] };
  
  exports.uptime = function () { return 0 };
  
  exports.freemem = function () {
      return Number.MAX_VALUE;
  };
  
  exports.totalmem = function () {
      return Number.MAX_VALUE;
  };
  
  exports.cpus = function () { return [] };
  
  exports.type = function () { return 'Browser' };
  
  exports.release = function () {
      if (typeof navigator !== 'undefined') {
          return navigator.appVersion;
      }
      return '';
  };
  
  exports.networkInterfaces
  = exports.getNetworkInterfaces
  = function () { return {} };
  
  exports.arch = function () { return 'javascript' };
  
  exports.platform = function () { return 'browser' };
  
  exports.tmpdir = exports.tmpDir = function () {
      return '/tmp';
  };
  
  exports.EOL = '\n';
  
  exports.homedir = function () {
    return '/'
  };
  
  },{}],10:[function(require,module,exports){
  (function (process){(function (){
  // 'path' module extracted from Node.js v8.11.1 (only the posix part)
  // transplited with Babel
  
  // Copyright Joyent, Inc. and other Node contributors.
  //
  // Permission is hereby granted, free of charge, to any person obtaining a
  // copy of this software and associated documentation files (the
  // "Software"), to deal in the Software without restriction, including
  // without limitation the rights to use, copy, modify, merge, publish,
  // distribute, sublicense, and/or sell copies of the Software, and to permit
  // persons to whom the Software is furnished to do so, subject to the
  // following conditions:
  //
  // The above copyright notice and this permission notice shall be included
  // in all copies or substantial portions of the Software.
  //
  // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
  // OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  // MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
  // NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
  // DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  // OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
  // USE OR OTHER DEALINGS IN THE SOFTWARE.
  
  'use strict';
  
  function assertPath(path) {
    if (typeof path !== 'string') {
      throw new TypeError('Path must be a string. Received ' + JSON.stringify(path));
    }
  }
  
  // Resolves . and .. elements in a path with directory names
  function normalizeStringPosix(path, allowAboveRoot) {
    var res = '';
    var lastSegmentLength = 0;
    var lastSlash = -1;
    var dots = 0;
    var code;
    for (var i = 0; i <= path.length; ++i) {
      if (i < path.length)
        code = path.charCodeAt(i);
      else if (code === 47 /*/*/)
        break;
      else
        code = 47 /*/*/;
      if (code === 47 /*/*/) {
        if (lastSlash === i - 1 || dots === 1) {
          // NOOP
        } else if (lastSlash !== i - 1 && dots === 2) {
          if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== 46 /*.*/ || res.charCodeAt(res.length - 2) !== 46 /*.*/) {
            if (res.length > 2) {
              var lastSlashIndex = res.lastIndexOf('/');
              if (lastSlashIndex !== res.length - 1) {
                if (lastSlashIndex === -1) {
                  res = '';
                  lastSegmentLength = 0;
                } else {
                  res = res.slice(0, lastSlashIndex);
                  lastSegmentLength = res.length - 1 - res.lastIndexOf('/');
                }
                lastSlash = i;
                dots = 0;
                continue;
              }
            } else if (res.length === 2 || res.length === 1) {
              res = '';
              lastSegmentLength = 0;
              lastSlash = i;
              dots = 0;
              continue;
            }
          }
          if (allowAboveRoot) {
            if (res.length > 0)
              res += '/..';
            else
              res = '..';
            lastSegmentLength = 2;
          }
        } else {
          if (res.length > 0)
            res += '/' + path.slice(lastSlash + 1, i);
          else
            res = path.slice(lastSlash + 1, i);
          lastSegmentLength = i - lastSlash - 1;
        }
        lastSlash = i;
        dots = 0;
      } else if (code === 46 /*.*/ && dots !== -1) {
        ++dots;
      } else {
        dots = -1;
      }
    }
    return res;
  }
  
  function _format(sep, pathObject) {
    var dir = pathObject.dir || pathObject.root;
    var base = pathObject.base || (pathObject.name || '') + (pathObject.ext || '');
    if (!dir) {
      return base;
    }
    if (dir === pathObject.root) {
      return dir + base;
    }
    return dir + sep + base;
  }
  
  var posix = {
    // path.resolve([from ...], to)
    resolve: function resolve() {
      var resolvedPath = '';
      var resolvedAbsolute = false;
      var cwd;
  
      for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
        var path;
        if (i >= 0)
          path = arguments[i];
        else {
          if (cwd === undefined)
            cwd = process.cwd();
          path = cwd;
        }
  
        assertPath(path);
  
        // Skip empty entries
        if (path.length === 0) {
          continue;
        }
  
        resolvedPath = path + '/' + resolvedPath;
        resolvedAbsolute = path.charCodeAt(0) === 47 /*/*/;
      }
  
      // At this point the path should be resolved to a full absolute path, but
      // handle relative paths to be safe (might happen when process.cwd() fails)
  
      // Normalize the path
      resolvedPath = normalizeStringPosix(resolvedPath, !resolvedAbsolute);
  
      if (resolvedAbsolute) {
        if (resolvedPath.length > 0)
          return '/' + resolvedPath;
        else
          return '/';
      } else if (resolvedPath.length > 0) {
        return resolvedPath;
      } else {
        return '.';
      }
    },
  
    normalize: function normalize(path) {
      assertPath(path);
  
      if (path.length === 0) return '.';
  
      var isAbsolute = path.charCodeAt(0) === 47 /*/*/;
      var trailingSeparator = path.charCodeAt(path.length - 1) === 47 /*/*/;
  
      // Normalize the path
      path = normalizeStringPosix(path, !isAbsolute);
  
      if (path.length === 0 && !isAbsolute) path = '.';
      if (path.length > 0 && trailingSeparator) path += '/';
  
      if (isAbsolute) return '/' + path;
      return path;
    },
  
    isAbsolute: function isAbsolute(path) {
      assertPath(path);
      return path.length > 0 && path.charCodeAt(0) === 47 /*/*/;
    },
  
    join: function join() {
      if (arguments.length === 0)
        return '.';
      var joined;
      for (var i = 0; i < arguments.length; ++i) {
        var arg = arguments[i];
        assertPath(arg);
        if (arg.length > 0) {
          if (joined === undefined)
            joined = arg;
          else
            joined += '/' + arg;
        }
      }
      if (joined === undefined)
        return '.';
      return posix.normalize(joined);
    },
  
    relative: function relative(from, to) {
      assertPath(from);
      assertPath(to);
  
      if (from === to) return '';
  
      from = posix.resolve(from);
      to = posix.resolve(to);
  
      if (from === to) return '';
  
      // Trim any leading backslashes
      var fromStart = 1;
      for (; fromStart < from.length; ++fromStart) {
        if (from.charCodeAt(fromStart) !== 47 /*/*/)
          break;
      }
      var fromEnd = from.length;
      var fromLen = fromEnd - fromStart;
  
      // Trim any leading backslashes
      var toStart = 1;
      for (; toStart < to.length; ++toStart) {
        if (to.charCodeAt(toStart) !== 47 /*/*/)
          break;
      }
      var toEnd = to.length;
      var toLen = toEnd - toStart;
  
      // Compare paths to find the longest common path from root
      var length = fromLen < toLen ? fromLen : toLen;
      var lastCommonSep = -1;
      var i = 0;
      for (; i <= length; ++i) {
        if (i === length) {
          if (toLen > length) {
            if (to.charCodeAt(toStart + i) === 47 /*/*/) {
              // We get here if `from` is the exact base path for `to`.
              // For example: from='/foo/bar'; to='/foo/bar/baz'
              return to.slice(toStart + i + 1);
            } else if (i === 0) {
              // We get here if `from` is the root
              // For example: from='/'; to='/foo'
              return to.slice(toStart + i);
            }
          } else if (fromLen > length) {
            if (from.charCodeAt(fromStart + i) === 47 /*/*/) {
              // We get here if `to` is the exact base path for `from`.
              // For example: from='/foo/bar/baz'; to='/foo/bar'
              lastCommonSep = i;
            } else if (i === 0) {
              // We get here if `to` is the root.
              // For example: from='/foo'; to='/'
              lastCommonSep = 0;
            }
          }
          break;
        }
        var fromCode = from.charCodeAt(fromStart + i);
        var toCode = to.charCodeAt(toStart + i);
        if (fromCode !== toCode)
          break;
        else if (fromCode === 47 /*/*/)
          lastCommonSep = i;
      }
  
      var out = '';
      // Generate the relative path based on the path difference between `to`
      // and `from`
      for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
        if (i === fromEnd || from.charCodeAt(i) === 47 /*/*/) {
          if (out.length === 0)
            out += '..';
          else
            out += '/..';
        }
      }
  
      // Lastly, append the rest of the destination (`to`) path that comes after
      // the common path parts
      if (out.length > 0)
        return out + to.slice(toStart + lastCommonSep);
      else {
        toStart += lastCommonSep;
        if (to.charCodeAt(toStart) === 47 /*/*/)
          ++toStart;
        return to.slice(toStart);
      }
    },
  
    _makeLong: function _makeLong(path) {
      return path;
    },
  
    dirname: function dirname(path) {
      assertPath(path);
      if (path.length === 0) return '.';
      var code = path.charCodeAt(0);
      var hasRoot = code === 47 /*/*/;
      var end = -1;
      var matchedSlash = true;
      for (var i = path.length - 1; i >= 1; --i) {
        code = path.charCodeAt(i);
        if (code === 47 /*/*/) {
            if (!matchedSlash) {
              end = i;
              break;
            }
          } else {
          // We saw the first non-path separator
          matchedSlash = false;
        }
      }
  
      if (end === -1) return hasRoot ? '/' : '.';
      if (hasRoot && end === 1) return '//';
      return path.slice(0, end);
    },
  
    basename: function basename(path, ext) {
      if (ext !== undefined && typeof ext !== 'string') throw new TypeError('"ext" argument must be a string');
      assertPath(path);
  
      var start = 0;
      var end = -1;
      var matchedSlash = true;
      var i;
  
      if (ext !== undefined && ext.length > 0 && ext.length <= path.length) {
        if (ext.length === path.length && ext === path) return '';
        var extIdx = ext.length - 1;
        var firstNonSlashEnd = -1;
        for (i = path.length - 1; i >= 0; --i) {
          var code = path.charCodeAt(i);
          if (code === 47 /*/*/) {
              // If we reached a path separator that was not part of a set of path
              // separators at the end of the string, stop now
              if (!matchedSlash) {
                start = i + 1;
                break;
              }
            } else {
            if (firstNonSlashEnd === -1) {
              // We saw the first non-path separator, remember this index in case
              // we need it if the extension ends up not matching
              matchedSlash = false;
              firstNonSlashEnd = i + 1;
            }
            if (extIdx >= 0) {
              // Try to match the explicit extension
              if (code === ext.charCodeAt(extIdx)) {
                if (--extIdx === -1) {
                  // We matched the extension, so mark this as the end of our path
                  // component
                  end = i;
                }
              } else {
                // Extension does not match, so our result is the entire path
                // component
                extIdx = -1;
                end = firstNonSlashEnd;
              }
            }
          }
        }
  
        if (start === end) end = firstNonSlashEnd;else if (end === -1) end = path.length;
        return path.slice(start, end);
      } else {
        for (i = path.length - 1; i >= 0; --i) {
          if (path.charCodeAt(i) === 47 /*/*/) {
              // If we reached a path separator that was not part of a set of path
              // separators at the end of the string, stop now
              if (!matchedSlash) {
                start = i + 1;
                break;
              }
            } else if (end === -1) {
            // We saw the first non-path separator, mark this as the end of our
            // path component
            matchedSlash = false;
            end = i + 1;
          }
        }
  
        if (end === -1) return '';
        return path.slice(start, end);
      }
    },
  
    extname: function extname(path) {
      assertPath(path);
      var startDot = -1;
      var startPart = 0;
      var end = -1;
      var matchedSlash = true;
      // Track the state of characters (if any) we see before our first dot and
      // after any path separator we find
      var preDotState = 0;
      for (var i = path.length - 1; i >= 0; --i) {
        var code = path.charCodeAt(i);
        if (code === 47 /*/*/) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if (!matchedSlash) {
              startPart = i + 1;
              break;
            }
            continue;
          }
        if (end === -1) {
          // We saw the first non-path separator, mark this as the end of our
          // extension
          matchedSlash = false;
          end = i + 1;
        }
        if (code === 46 /*.*/) {
            // If this is our first dot, mark it as the start of our extension
            if (startDot === -1)
              startDot = i;
            else if (preDotState !== 1)
              preDotState = 1;
        } else if (startDot !== -1) {
          // We saw a non-dot and non-path separator before our dot, so we should
          // have a good chance at having a non-empty extension
          preDotState = -1;
        }
      }
  
      if (startDot === -1 || end === -1 ||
          // We saw a non-dot character immediately before the dot
          preDotState === 0 ||
          // The (right-most) trimmed path component is exactly '..'
          preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
        return '';
      }
      return path.slice(startDot, end);
    },
  
    format: function format(pathObject) {
      if (pathObject === null || typeof pathObject !== 'object') {
        throw new TypeError('The "pathObject" argument must be of type Object. Received type ' + typeof pathObject);
      }
      return _format('/', pathObject);
    },
  
    parse: function parse(path) {
      assertPath(path);
  
      var ret = { root: '', dir: '', base: '', ext: '', name: '' };
      if (path.length === 0) return ret;
      var code = path.charCodeAt(0);
      var isAbsolute = code === 47 /*/*/;
      var start;
      if (isAbsolute) {
        ret.root = '/';
        start = 1;
      } else {
        start = 0;
      }
      var startDot = -1;
      var startPart = 0;
      var end = -1;
      var matchedSlash = true;
      var i = path.length - 1;
  
      // Track the state of characters (if any) we see before our first dot and
      // after any path separator we find
      var preDotState = 0;
  
      // Get non-dir info
      for (; i >= start; --i) {
        code = path.charCodeAt(i);
        if (code === 47 /*/*/) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if (!matchedSlash) {
              startPart = i + 1;
              break;
            }
            continue;
          }
        if (end === -1) {
          // We saw the first non-path separator, mark this as the end of our
          // extension
          matchedSlash = false;
          end = i + 1;
        }
        if (code === 46 /*.*/) {
            // If this is our first dot, mark it as the start of our extension
            if (startDot === -1) startDot = i;else if (preDotState !== 1) preDotState = 1;
          } else if (startDot !== -1) {
          // We saw a non-dot and non-path separator before our dot, so we should
          // have a good chance at having a non-empty extension
          preDotState = -1;
        }
      }
  
      if (startDot === -1 || end === -1 ||
      // We saw a non-dot character immediately before the dot
      preDotState === 0 ||
      // The (right-most) trimmed path component is exactly '..'
      preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
        if (end !== -1) {
          if (startPart === 0 && isAbsolute) ret.base = ret.name = path.slice(1, end);else ret.base = ret.name = path.slice(startPart, end);
        }
      } else {
        if (startPart === 0 && isAbsolute) {
          ret.name = path.slice(1, startDot);
          ret.base = path.slice(1, end);
        } else {
          ret.name = path.slice(startPart, startDot);
          ret.base = path.slice(startPart, end);
        }
        ret.ext = path.slice(startDot, end);
      }
  
      if (startPart > 0) ret.dir = path.slice(0, startPart - 1);else if (isAbsolute) ret.dir = '/';
  
      return ret;
    },
  
    sep: '/',
    delimiter: ':',
    win32: null,
    posix: null
  };
  
  posix.posix = posix;
  
  module.exports = posix;
  
  }).call(this)}).call(this,require('_process'))
  },{"_process":11}],11:[function(require,module,exports){
  // shim for using process in browser
  var process = module.exports = {};
  
  // cached from whatever global is present so that test runners that stub it
  // don't break things.  But we need to wrap it in a try catch in case it is
  // wrapped in strict mode code which doesn't define any globals.  It's inside a
  // function because try/catches deoptimize in certain engines.
  
  var cachedSetTimeout;
  var cachedClearTimeout;
  
  function defaultSetTimout() {
      throw new Error('setTimeout has not been defined');
  }
  function defaultClearTimeout () {
      throw new Error('clearTimeout has not been defined');
  }
  (function () {
      try {
          if (typeof setTimeout === 'function') {
              cachedSetTimeout = setTimeout;
          } else {
              cachedSetTimeout = defaultSetTimout;
          }
      } catch (e) {
          cachedSetTimeout = defaultSetTimout;
      }
      try {
          if (typeof clearTimeout === 'function') {
              cachedClearTimeout = clearTimeout;
          } else {
              cachedClearTimeout = defaultClearTimeout;
          }
      } catch (e) {
          cachedClearTimeout = defaultClearTimeout;
      }
  } ())
  function runTimeout(fun) {
      if (cachedSetTimeout === setTimeout) {
          //normal enviroments in sane situations
          return setTimeout(fun, 0);
      }
      // if setTimeout wasn't available but was latter defined
      if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
          cachedSetTimeout = setTimeout;
          return setTimeout(fun, 0);
      }
      try {
          // when when somebody has screwed with setTimeout but no I.E. maddness
          return cachedSetTimeout(fun, 0);
      } catch(e){
          try {
              // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
              return cachedSetTimeout.call(null, fun, 0);
          } catch(e){
              // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
              return cachedSetTimeout.call(this, fun, 0);
          }
      }
  
  
  }
  function runClearTimeout(marker) {
      if (cachedClearTimeout === clearTimeout) {
          //normal enviroments in sane situations
          return clearTimeout(marker);
      }
      // if clearTimeout wasn't available but was latter defined
      if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
          cachedClearTimeout = clearTimeout;
          return clearTimeout(marker);
      }
      try {
          // when when somebody has screwed with setTimeout but no I.E. maddness
          return cachedClearTimeout(marker);
      } catch (e){
          try {
              // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
              return cachedClearTimeout.call(null, marker);
          } catch (e){
              // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
              // Some versions of I.E. have different rules for clearTimeout vs setTimeout
              return cachedClearTimeout.call(this, marker);
          }
      }
  
  
  
  }
  var queue = [];
  var draining = false;
  var currentQueue;
  var queueIndex = -1;
  
  function cleanUpNextTick() {
      if (!draining || !currentQueue) {
          return;
      }
      draining = false;
      if (currentQueue.length) {
          queue = currentQueue.concat(queue);
      } else {
          queueIndex = -1;
      }
      if (queue.length) {
          drainQueue();
      }
  }
  
  function drainQueue() {
      if (draining) {
          return;
      }
      var timeout = runTimeout(cleanUpNextTick);
      draining = true;
  
      var len = queue.length;
      while(len) {
          currentQueue = queue;
          queue = [];
          while (++queueIndex < len) {
              if (currentQueue) {
                  currentQueue[queueIndex].run();
              }
          }
          queueIndex = -1;
          len = queue.length;
      }
      currentQueue = null;
      draining = false;
      runClearTimeout(timeout);
  }
  
  process.nextTick = function (fun) {
      var args = new Array(arguments.length - 1);
      if (arguments.length > 1) {
          for (var i = 1; i < arguments.length; i++) {
              args[i - 1] = arguments[i];
          }
      }
      queue.push(new Item(fun, args));
      if (queue.length === 1 && !draining) {
          runTimeout(drainQueue);
      }
  };
  
  // v8 likes predictible objects
  function Item(fun, array) {
      this.fun = fun;
      this.array = array;
  }
  Item.prototype.run = function () {
      this.fun.apply(null, this.array);
  };
  process.title = 'browser';
  process.browser = true;
  process.env = {};
  process.argv = [];
  process.version = ''; // empty string to avoid regexp issues
  process.versions = {};
  
  function noop() {}
  
  process.on = noop;
  process.addListener = noop;
  process.once = noop;
  process.off = noop;
  process.removeListener = noop;
  process.removeAllListeners = noop;
  process.emit = noop;
  process.prependListener = noop;
  process.prependOnceListener = noop;
  
  process.listeners = function (name) { return [] }
  
  process.binding = function (name) {
      throw new Error('process.binding is not supported');
  };
  
  process.cwd = function () { return '/' };
  process.chdir = function (dir) {
      throw new Error('process.chdir is not supported');
  };
  process.umask = function() { return 0; };
  
  },{}],12:[function(require,module,exports){
  (function (global){(function (){
  /*! https://mths.be/punycode v1.4.1 by @mathias */
  ;(function(root) {
  
    /** Detect free variables */
    var freeExports = typeof exports == 'object' && exports &&
      !exports.nodeType && exports;
    var freeModule = typeof module == 'object' && module &&
      !module.nodeType && module;
    var freeGlobal = typeof global == 'object' && global;
    if (
      freeGlobal.global === freeGlobal ||
      freeGlobal.window === freeGlobal ||
      freeGlobal.self === freeGlobal
    ) {
      root = freeGlobal;
    }
  
    /**
     * The `punycode` object.
     * @name punycode
     * @type Object
     */
    var punycode,
  
    /** Highest positive signed 32-bit float value */
    maxInt = 2147483647, // aka. 0x7FFFFFFF or 2^31-1
  
    /** Bootstring parameters */
    base = 36,
    tMin = 1,
    tMax = 26,
    skew = 38,
    damp = 700,
    initialBias = 72,
    initialN = 128, // 0x80
    delimiter = '-', // '\x2D'
  
    /** Regular expressions */
    regexPunycode = /^xn--/,
    regexNonASCII = /[^\x20-\x7E]/, // unprintable ASCII chars + non-ASCII chars
    regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g, // RFC 3490 separators
  
    /** Error messages */
    errors = {
      'overflow': 'Overflow: input needs wider integers to process',
      'not-basic': 'Illegal input >= 0x80 (not a basic code point)',
      'invalid-input': 'Invalid input'
    },
  
    /** Convenience shortcuts */
    baseMinusTMin = base - tMin,
    floor = Math.floor,
    stringFromCharCode = String.fromCharCode,
  
    /** Temporary variable */
    key;
  
    /*--------------------------------------------------------------------------*/
  
    /**
     * A generic error utility function.
     * @private
     * @param {String} type The error type.
     * @returns {Error} Throws a `RangeError` with the applicable error message.
     */
    function error(type) {
      throw new RangeError(errors[type]);
    }
  
    /**
     * A generic `Array#map` utility function.
     * @private
     * @param {Array} array The array to iterate over.
     * @param {Function} callback The function that gets called for every array
     * item.
     * @returns {Array} A new array of values returned by the callback function.
     */
    function map(array, fn) {
      var length = array.length;
      var result = [];
      while (length--) {
        result[length] = fn(array[length]);
      }
      return result;
    }
  
    /**
     * A simple `Array#map`-like wrapper to work with domain name strings or email
     * addresses.
     * @private
     * @param {String} domain The domain name or email address.
     * @param {Function} callback The function that gets called for every
     * character.
     * @returns {Array} A new string of characters returned by the callback
     * function.
     */
    function mapDomain(string, fn) {
      var parts = string.split('@');
      var result = '';
      if (parts.length > 1) {
        // In email addresses, only the domain name should be punycoded. Leave
        // the local part (i.e. everything up to `@`) intact.
        result = parts[0] + '@';
        string = parts[1];
      }
      // Avoid `split(regex)` for IE8 compatibility. See #17.
      string = string.replace(regexSeparators, '\x2E');
      var labels = string.split('.');
      var encoded = map(labels, fn).join('.');
      return result + encoded;
    }
  
    /**
     * Creates an array containing the numeric code points of each Unicode
     * character in the string. While JavaScript uses UCS-2 internally,
     * this function will convert a pair of surrogate halves (each of which
     * UCS-2 exposes as separate characters) into a single code point,
     * matching UTF-16.
     * @see `punycode.ucs2.encode`
     * @see <https://mathiasbynens.be/notes/javascript-encoding>
     * @memberOf punycode.ucs2
     * @name decode
     * @param {String} string The Unicode input string (UCS-2).
     * @returns {Array} The new array of code points.
     */
    function ucs2decode(string) {
      var output = [],
          counter = 0,
          length = string.length,
          value,
          extra;
      while (counter < length) {
        value = string.charCodeAt(counter++);
        if (value >= 0xD800 && value <= 0xDBFF && counter < length) {
          // high surrogate, and there is a next character
          extra = string.charCodeAt(counter++);
          if ((extra & 0xFC00) == 0xDC00) { // low surrogate
            output.push(((value & 0x3FF) << 10) + (extra & 0x3FF) + 0x10000);
          } else {
            // unmatched surrogate; only append this code unit, in case the next
            // code unit is the high surrogate of a surrogate pair
            output.push(value);
            counter--;
          }
        } else {
          output.push(value);
        }
      }
      return output;
    }
  
    /**
     * Creates a string based on an array of numeric code points.
     * @see `punycode.ucs2.decode`
     * @memberOf punycode.ucs2
     * @name encode
     * @param {Array} codePoints The array of numeric code points.
     * @returns {String} The new Unicode string (UCS-2).
     */
    function ucs2encode(array) {
      return map(array, function(value) {
        var output = '';
        if (value > 0xFFFF) {
          value -= 0x10000;
          output += stringFromCharCode(value >>> 10 & 0x3FF | 0xD800);
          value = 0xDC00 | value & 0x3FF;
        }
        output += stringFromCharCode(value);
        return output;
      }).join('');
    }
  
    /**
     * Converts a basic code point into a digit/integer.
     * @see `digitToBasic()`
     * @private
     * @param {Number} codePoint The basic numeric code point value.
     * @returns {Number} The numeric value of a basic code point (for use in
     * representing integers) in the range `0` to `base - 1`, or `base` if
     * the code point does not represent a value.
     */
    function basicToDigit(codePoint) {
      if (codePoint - 48 < 10) {
        return codePoint - 22;
      }
      if (codePoint - 65 < 26) {
        return codePoint - 65;
      }
      if (codePoint - 97 < 26) {
        return codePoint - 97;
      }
      return base;
    }
  
    /**
     * Converts a digit/integer into a basic code point.
     * @see `basicToDigit()`
     * @private
     * @param {Number} digit The numeric value of a basic code point.
     * @returns {Number} The basic code point whose value (when used for
     * representing integers) is `digit`, which needs to be in the range
     * `0` to `base - 1`. If `flag` is non-zero, the uppercase form is
     * used; else, the lowercase form is used. The behavior is undefined
     * if `flag` is non-zero and `digit` has no uppercase form.
     */
    function digitToBasic(digit, flag) {
      //  0..25 map to ASCII a..z or A..Z
      // 26..35 map to ASCII 0..9
      return digit + 22 + 75 * (digit < 26) - ((flag != 0) << 5);
    }
  
    /**
     * Bias adaptation function as per section 3.4 of RFC 3492.
     * https://tools.ietf.org/html/rfc3492#section-3.4
     * @private
     */
    function adapt(delta, numPoints, firstTime) {
      var k = 0;
      delta = firstTime ? floor(delta / damp) : delta >> 1;
      delta += floor(delta / numPoints);
      for (/* no initialization */; delta > baseMinusTMin * tMax >> 1; k += base) {
        delta = floor(delta / baseMinusTMin);
      }
      return floor(k + (baseMinusTMin + 1) * delta / (delta + skew));
    }
  
    /**
     * Converts a Punycode string of ASCII-only symbols to a string of Unicode
     * symbols.
     * @memberOf punycode
     * @param {String} input The Punycode string of ASCII-only symbols.
     * @returns {String} The resulting string of Unicode symbols.
     */
    function decode(input) {
      // Don't use UCS-2
      var output = [],
          inputLength = input.length,
          out,
          i = 0,
          n = initialN,
          bias = initialBias,
          basic,
          j,
          index,
          oldi,
          w,
          k,
          digit,
          t,
          /** Cached calculation results */
          baseMinusT;
  
      // Handle the basic code points: let `basic` be the number of input code
      // points before the last delimiter, or `0` if there is none, then copy
      // the first basic code points to the output.
  
      basic = input.lastIndexOf(delimiter);
      if (basic < 0) {
        basic = 0;
      }
  
      for (j = 0; j < basic; ++j) {
        // if it's not a basic code point
        if (input.charCodeAt(j) >= 0x80) {
          error('not-basic');
        }
        output.push(input.charCodeAt(j));
      }
  
      // Main decoding loop: start just after the last delimiter if any basic code
      // points were copied; start at the beginning otherwise.
  
      for (index = basic > 0 ? basic + 1 : 0; index < inputLength; /* no final expression */) {
  
        // `index` is the index of the next character to be consumed.
        // Decode a generalized variable-length integer into `delta`,
        // which gets added to `i`. The overflow checking is easier
        // if we increase `i` as we go, then subtract off its starting
        // value at the end to obtain `delta`.
        for (oldi = i, w = 1, k = base; /* no condition */; k += base) {
  
          if (index >= inputLength) {
            error('invalid-input');
          }
  
          digit = basicToDigit(input.charCodeAt(index++));
  
          if (digit >= base || digit > floor((maxInt - i) / w)) {
            error('overflow');
          }
  
          i += digit * w;
          t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
  
          if (digit < t) {
            break;
          }
  
          baseMinusT = base - t;
          if (w > floor(maxInt / baseMinusT)) {
            error('overflow');
          }
  
          w *= baseMinusT;
  
        }
  
        out = output.length + 1;
        bias = adapt(i - oldi, out, oldi == 0);
  
        // `i` was supposed to wrap around from `out` to `0`,
        // incrementing `n` each time, so we'll fix that now:
        if (floor(i / out) > maxInt - n) {
          error('overflow');
        }
  
        n += floor(i / out);
        i %= out;
  
        // Insert `n` at position `i` of the output
        output.splice(i++, 0, n);
  
      }
  
      return ucs2encode(output);
    }
  
    /**
     * Converts a string of Unicode symbols (e.g. a domain name label) to a
     * Punycode string of ASCII-only symbols.
     * @memberOf punycode
     * @param {String} input The string of Unicode symbols.
     * @returns {String} The resulting Punycode string of ASCII-only symbols.
     */
    function encode(input) {
      var n,
          delta,
          handledCPCount,
          basicLength,
          bias,
          j,
          m,
          q,
          k,
          t,
          currentValue,
          output = [],
          /** `inputLength` will hold the number of code points in `input`. */
          inputLength,
          /** Cached calculation results */
          handledCPCountPlusOne,
          baseMinusT,
          qMinusT;
  
      // Convert the input in UCS-2 to Unicode
      input = ucs2decode(input);
  
      // Cache the length
      inputLength = input.length;
  
      // Initialize the state
      n = initialN;
      delta = 0;
      bias = initialBias;
  
      // Handle the basic code points
      for (j = 0; j < inputLength; ++j) {
        currentValue = input[j];
        if (currentValue < 0x80) {
          output.push(stringFromCharCode(currentValue));
        }
      }
  
      handledCPCount = basicLength = output.length;
  
      // `handledCPCount` is the number of code points that have been handled;
      // `basicLength` is the number of basic code points.
  
      // Finish the basic string - if it is not empty - with a delimiter
      if (basicLength) {
        output.push(delimiter);
      }
  
      // Main encoding loop:
      while (handledCPCount < inputLength) {
  
        // All non-basic code points < n have been handled already. Find the next
        // larger one:
        for (m = maxInt, j = 0; j < inputLength; ++j) {
          currentValue = input[j];
          if (currentValue >= n && currentValue < m) {
            m = currentValue;
          }
        }
  
        // Increase `delta` enough to advance the decoder's <n,i> state to <m,0>,
        // but guard against overflow
        handledCPCountPlusOne = handledCPCount + 1;
        if (m - n > floor((maxInt - delta) / handledCPCountPlusOne)) {
          error('overflow');
        }
  
        delta += (m - n) * handledCPCountPlusOne;
        n = m;
  
        for (j = 0; j < inputLength; ++j) {
          currentValue = input[j];
  
          if (currentValue < n && ++delta > maxInt) {
            error('overflow');
          }
  
          if (currentValue == n) {
            // Represent delta as a generalized variable-length integer
            for (q = delta, k = base; /* no condition */; k += base) {
              t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
              if (q < t) {
                break;
              }
              qMinusT = q - t;
              baseMinusT = base - t;
              output.push(
                stringFromCharCode(digitToBasic(t + qMinusT % baseMinusT, 0))
              );
              q = floor(qMinusT / baseMinusT);
            }
  
            output.push(stringFromCharCode(digitToBasic(q, 0)));
            bias = adapt(delta, handledCPCountPlusOne, handledCPCount == basicLength);
            delta = 0;
            ++handledCPCount;
          }
        }
  
        ++delta;
        ++n;
  
      }
      return output.join('');
    }
  
    /**
     * Converts a Punycode string representing a domain name or an email address
     * to Unicode. Only the Punycoded parts of the input will be converted, i.e.
     * it doesn't matter if you call it on a string that has already been
     * converted to Unicode.
     * @memberOf punycode
     * @param {String} input The Punycoded domain name or email address to
     * convert to Unicode.
     * @returns {String} The Unicode representation of the given Punycode
     * string.
     */
    function toUnicode(input) {
      return mapDomain(input, function(string) {
        return regexPunycode.test(string)
          ? decode(string.slice(4).toLowerCase())
          : string;
      });
    }
  
    /**
     * Converts a Unicode string representing a domain name or an email address to
     * Punycode. Only the non-ASCII parts of the domain name will be converted,
     * i.e. it doesn't matter if you call it with a domain that's already in
     * ASCII.
     * @memberOf punycode
     * @param {String} input The domain name or email address to convert, as a
     * Unicode string.
     * @returns {String} The Punycode representation of the given domain name or
     * email address.
     */
    function toASCII(input) {
      return mapDomain(input, function(string) {
        return regexNonASCII.test(string)
          ? 'xn--' + encode(string)
          : string;
      });
    }
  
    /*--------------------------------------------------------------------------*/
  
    /** Define the public API */
    punycode = {
      /**
       * A string representing the current Punycode.js version number.
       * @memberOf punycode
       * @type String
       */
      'version': '1.4.1',
      /**
       * An object of methods to convert from JavaScript's internal character
       * representation (UCS-2) to Unicode code points, and back.
       * @see <https://mathiasbynens.be/notes/javascript-encoding>
       * @memberOf punycode
       * @type Object
       */
      'ucs2': {
        'decode': ucs2decode,
        'encode': ucs2encode
      },
      'decode': decode,
      'encode': encode,
      'toASCII': toASCII,
      'toUnicode': toUnicode
    };
  
    /** Expose `punycode` */
    // Some AMD build optimizers, like r.js, check for specific condition patterns
    // like the following:
    if (
      typeof define == 'function' &&
      typeof define.amd == 'object' &&
      define.amd
    ) {
      define('punycode', function() {
        return punycode;
      });
    } else if (freeExports && freeModule) {
      if (module.exports == freeExports) {
        // in Node.js, io.js, or RingoJS v0.8.0+
        freeModule.exports = punycode;
      } else {
        // in Narwhal or RingoJS v0.7.0-
        for (key in punycode) {
          punycode.hasOwnProperty(key) && (freeExports[key] = punycode[key]);
        }
      }
    } else {
      // in Rhino or a web browser
      root.punycode = punycode;
    }
  
  }(this));
  
  }).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
  },{}],13:[function(require,module,exports){
  // Copyright Joyent, Inc. and other Node contributors.
  //
  // Permission is hereby granted, free of charge, to any person obtaining a
  // copy of this software and associated documentation files (the
  // "Software"), to deal in the Software without restriction, including
  // without limitation the rights to use, copy, modify, merge, publish,
  // distribute, sublicense, and/or sell copies of the Software, and to permit
  // persons to whom the Software is furnished to do so, subject to the
  // following conditions:
  //
  // The above copyright notice and this permission notice shall be included
  // in all copies or substantial portions of the Software.
  //
  // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
  // OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  // MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
  // NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
  // DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  // OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
  // USE OR OTHER DEALINGS IN THE SOFTWARE.
  
  'use strict';
  
  // If obj.hasOwnProperty has been overridden, then calling
  // obj.hasOwnProperty(prop) will break.
  // See: https://github.com/joyent/node/issues/1707
  function hasOwnProperty(obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
  }
  
  module.exports = function(qs, sep, eq, options) {
    sep = sep || '&';
    eq = eq || '=';
    var obj = {};
  
    if (typeof qs !== 'string' || qs.length === 0) {
      return obj;
    }
  
    var regexp = /\+/g;
    qs = qs.split(sep);
  
    var maxKeys = 1000;
    if (options && typeof options.maxKeys === 'number') {
      maxKeys = options.maxKeys;
    }
  
    var len = qs.length;
    // maxKeys <= 0 means that we should not limit keys count
    if (maxKeys > 0 && len > maxKeys) {
      len = maxKeys;
    }
  
    for (var i = 0; i < len; ++i) {
      var x = qs[i].replace(regexp, '%20'),
          idx = x.indexOf(eq),
          kstr, vstr, k, v;
  
      if (idx >= 0) {
        kstr = x.substr(0, idx);
        vstr = x.substr(idx + 1);
      } else {
        kstr = x;
        vstr = '';
      }
  
      k = decodeURIComponent(kstr);
      v = decodeURIComponent(vstr);
  
      if (!hasOwnProperty(obj, k)) {
        obj[k] = v;
      } else if (isArray(obj[k])) {
        obj[k].push(v);
      } else {
        obj[k] = [obj[k], v];
      }
    }
  
    return obj;
  };
  
  var isArray = Array.isArray || function (xs) {
    return Object.prototype.toString.call(xs) === '[object Array]';
  };
  
  },{}],14:[function(require,module,exports){
  // Copyright Joyent, Inc. and other Node contributors.
  //
  // Permission is hereby granted, free of charge, to any person obtaining a
  // copy of this software and associated documentation files (the
  // "Software"), to deal in the Software without restriction, including
  // without limitation the rights to use, copy, modify, merge, publish,
  // distribute, sublicense, and/or sell copies of the Software, and to permit
  // persons to whom the Software is furnished to do so, subject to the
  // following conditions:
  //
  // The above copyright notice and this permission notice shall be included
  // in all copies or substantial portions of the Software.
  //
  // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
  // OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  // MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
  // NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
  // DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  // OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
  // USE OR OTHER DEALINGS IN THE SOFTWARE.
  
  'use strict';
  
  var stringifyPrimitive = function(v) {
    switch (typeof v) {
      case 'string':
        return v;
  
      case 'boolean':
        return v ? 'true' : 'false';
  
      case 'number':
        return isFinite(v) ? v : '';
  
      default:
        return '';
    }
  };
  
  module.exports = function(obj, sep, eq, name) {
    sep = sep || '&';
    eq = eq || '=';
    if (obj === null) {
      obj = undefined;
    }
  
    if (typeof obj === 'object') {
      return map(objectKeys(obj), function(k) {
        var ks = encodeURIComponent(stringifyPrimitive(k)) + eq;
        if (isArray(obj[k])) {
          return map(obj[k], function(v) {
            return ks + encodeURIComponent(stringifyPrimitive(v));
          }).join(sep);
        } else {
          return ks + encodeURIComponent(stringifyPrimitive(obj[k]));
        }
      }).join(sep);
  
    }
  
    if (!name) return '';
    return encodeURIComponent(stringifyPrimitive(name)) + eq +
           encodeURIComponent(stringifyPrimitive(obj));
  };
  
  var isArray = Array.isArray || function (xs) {
    return Object.prototype.toString.call(xs) === '[object Array]';
  };
  
  function map (xs, f) {
    if (xs.map) return xs.map(f);
    var res = [];
    for (var i = 0; i < xs.length; i++) {
      res.push(f(xs[i], i));
    }
    return res;
  }
  
  var objectKeys = Object.keys || function (obj) {
    var res = [];
    for (var key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) res.push(key);
    }
    return res;
  };
  
  },{}],15:[function(require,module,exports){
  'use strict';
  
  exports.decode = exports.parse = require('./decode');
  exports.encode = exports.stringify = require('./encode');
  
  },{"./decode":13,"./encode":14}],16:[function(require,module,exports){
  /*! safe-buffer. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
  /* eslint-disable node/no-deprecated-api */
  var buffer = require('buffer')
  var Buffer = buffer.Buffer
  
  // alternative to using Object.keys for old browsers
  function copyProps (src, dst) {
    for (var key in src) {
      dst[key] = src[key]
    }
  }
  if (Buffer.from && Buffer.alloc && Buffer.allocUnsafe && Buffer.allocUnsafeSlow) {
    module.exports = buffer
  } else {
    // Copy properties from require('buffer')
    copyProps(buffer, exports)
    exports.Buffer = SafeBuffer
  }
  
  function SafeBuffer (arg, encodingOrOffset, length) {
    return Buffer(arg, encodingOrOffset, length)
  }
  
  SafeBuffer.prototype = Object.create(Buffer.prototype)
  
  // Copy static methods from Buffer
  copyProps(Buffer, SafeBuffer)
  
  SafeBuffer.from = function (arg, encodingOrOffset, length) {
    if (typeof arg === 'number') {
      throw new TypeError('Argument must not be a number')
    }
    return Buffer(arg, encodingOrOffset, length)
  }
  
  SafeBuffer.alloc = function (size, fill, encoding) {
    if (typeof size !== 'number') {
      throw new TypeError('Argument must be a number')
    }
    var buf = Buffer(size)
    if (fill !== undefined) {
      if (typeof encoding === 'string') {
        buf.fill(fill, encoding)
      } else {
        buf.fill(fill)
      }
    } else {
      buf.fill(0)
    }
    return buf
  }
  
  SafeBuffer.allocUnsafe = function (size) {
    if (typeof size !== 'number') {
      throw new TypeError('Argument must be a number')
    }
    return Buffer(size)
  }
  
  SafeBuffer.allocUnsafeSlow = function (size) {
    if (typeof size !== 'number') {
      throw new TypeError('Argument must be a number')
    }
    return buffer.SlowBuffer(size)
  }
  
  },{"buffer":3}],17:[function(require,module,exports){
  (function (global){(function (){
  var ClientRequest = require('./lib/request')
  var response = require('./lib/response')
  var extend = require('xtend')
  var statusCodes = require('builtin-status-codes')
  var url = require('url')
  
  var http = exports
  
  http.request = function (opts, cb) {
    if (typeof opts === 'string')
      opts = url.parse(opts)
    else
      opts = extend(opts)
  
    // Normally, the page is loaded from http or https, so not specifying a protocol
    // will result in a (valid) protocol-relative url. However, this won't work if
    // the protocol is something else, like 'file:'
    var defaultProtocol = global.location.protocol.search(/^https?:$/) === -1 ? 'http:' : ''
  
    var protocol = opts.protocol || defaultProtocol
    var host = opts.hostname || opts.host
    var port = opts.port
    var path = opts.path || '/'
  
    // Necessary for IPv6 addresses
    if (host && host.indexOf(':') !== -1)
      host = '[' + host + ']'
  
    // This may be a relative url. The browser should always be able to interpret it correctly.
    opts.url = (host ? (protocol + '//' + host) : '') + (port ? ':' + port : '') + path
    opts.method = (opts.method || 'GET').toUpperCase()
    opts.headers = opts.headers || {}
  
    // Also valid opts.auth, opts.mode
  
    var req = new ClientRequest(opts)
    if (cb)
      req.on('response', cb)
    return req
  }
  
  http.get = function get (opts, cb) {
    var req = http.request(opts, cb)
    req.end()
    return req
  }
  
  http.ClientRequest = ClientRequest
  http.IncomingMessage = response.IncomingMessage
  
  http.Agent = function () {}
  http.Agent.defaultMaxSockets = 4
  
  http.globalAgent = new http.Agent()
  
  http.STATUS_CODES = statusCodes
  
  http.METHODS = [
    'CHECKOUT',
    'CONNECT',
    'COPY',
    'DELETE',
    'GET',
    'HEAD',
    'LOCK',
    'M-SEARCH',
    'MERGE',
    'MKACTIVITY',
    'MKCOL',
    'MOVE',
    'NOTIFY',
    'OPTIONS',
    'PATCH',
    'POST',
    'PROPFIND',
    'PROPPATCH',
    'PURGE',
    'PUT',
    'REPORT',
    'SEARCH',
    'SUBSCRIBE',
    'TRACE',
    'UNLOCK',
    'UNSUBSCRIBE'
  ]
  }).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
  },{"./lib/request":19,"./lib/response":20,"builtin-status-codes":4,"url":37,"xtend":40}],18:[function(require,module,exports){
  (function (global){(function (){
  exports.fetch = isFunction(global.fetch) && isFunction(global.ReadableStream)
  
  exports.writableStream = isFunction(global.WritableStream)
  
  exports.abortController = isFunction(global.AbortController)
  
  // The xhr request to example.com may violate some restrictive CSP configurations,
  // so if we're running in a browser that supports `fetch`, avoid calling getXHR()
  // and assume support for certain features below.
  var xhr
  function getXHR () {
    // Cache the xhr value
    if (xhr !== undefined) return xhr
  
    if (global.XMLHttpRequest) {
      xhr = new global.XMLHttpRequest()
      // If XDomainRequest is available (ie only, where xhr might not work
      // cross domain), use the page location. Otherwise use example.com
      // Note: this doesn't actually make an http request.
      try {
        xhr.open('GET', global.XDomainRequest ? '/' : 'https://example.com')
      } catch(e) {
        xhr = null
      }
    } else {
      // Service workers don't have XHR
      xhr = null
    }
    return xhr
  }
  
  function checkTypeSupport (type) {
    var xhr = getXHR()
    if (!xhr) return false
    try {
      xhr.responseType = type
      return xhr.responseType === type
    } catch (e) {}
    return false
  }
  
  // If fetch is supported, then arraybuffer will be supported too. Skip calling
  // checkTypeSupport(), since that calls getXHR().
  exports.arraybuffer = exports.fetch || checkTypeSupport('arraybuffer')
  
  // These next two tests unavoidably show warnings in Chrome. Since fetch will always
  // be used if it's available, just return false for these to avoid the warnings.
  exports.msstream = !exports.fetch && checkTypeSupport('ms-stream')
  exports.mozchunkedarraybuffer = !exports.fetch && checkTypeSupport('moz-chunked-arraybuffer')
  
  // If fetch is supported, then overrideMimeType will be supported too. Skip calling
  // getXHR().
  exports.overrideMimeType = exports.fetch || (getXHR() ? isFunction(getXHR().overrideMimeType) : false)
  
  function isFunction (value) {
    return typeof value === 'function'
  }
  
  xhr = null // Help gc
  
  }).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
  },{}],19:[function(require,module,exports){
  (function (process,global,Buffer){(function (){
  var capability = require('./capability')
  var inherits = require('inherits')
  var response = require('./response')
  var stream = require('readable-stream')
  
  var IncomingMessage = response.IncomingMessage
  var rStates = response.readyStates
  
  function decideMode (preferBinary, useFetch) {
    if (capability.fetch && useFetch) {
      return 'fetch'
    } else if (capability.mozchunkedarraybuffer) {
      return 'moz-chunked-arraybuffer'
    } else if (capability.msstream) {
      return 'ms-stream'
    } else if (capability.arraybuffer && preferBinary) {
      return 'arraybuffer'
    } else {
      return 'text'
    }
  }
  
  var ClientRequest = module.exports = function (opts) {
    var self = this
    stream.Writable.call(self)
  
    self._opts = opts
    self._body = []
    self._headers = {}
    if (opts.auth)
      self.setHeader('Authorization', 'Basic ' + Buffer.from(opts.auth).toString('base64'))
    Object.keys(opts.headers).forEach(function (name) {
      self.setHeader(name, opts.headers[name])
    })
  
    var preferBinary
    var useFetch = true
    if (opts.mode === 'disable-fetch' || ('requestTimeout' in opts && !capability.abortController)) {
      // If the use of XHR should be preferred. Not typically needed.
      useFetch = false
      preferBinary = true
    } else if (opts.mode === 'prefer-streaming') {
      // If streaming is a high priority but binary compatibility and
      // the accuracy of the 'content-type' header aren't
      preferBinary = false
    } else if (opts.mode === 'allow-wrong-content-type') {
      // If streaming is more important than preserving the 'content-type' header
      preferBinary = !capability.overrideMimeType
    } else if (!opts.mode || opts.mode === 'default' || opts.mode === 'prefer-fast') {
      // Use binary if text streaming may corrupt data or the content-type header, or for speed
      preferBinary = true
    } else {
      throw new Error('Invalid value for opts.mode')
    }
    self._mode = decideMode(preferBinary, useFetch)
    self._fetchTimer = null
  
    self.on('finish', function () {
      self._onFinish()
    })
  }
  
  inherits(ClientRequest, stream.Writable)
  
  ClientRequest.prototype.setHeader = function (name, value) {
    var self = this
    var lowerName = name.toLowerCase()
    // This check is not necessary, but it prevents warnings from browsers about setting unsafe
    // headers. To be honest I'm not entirely sure hiding these warnings is a good thing, but
    // http-browserify did it, so I will too.
    if (unsafeHeaders.indexOf(lowerName) !== -1)
      return
  
    self._headers[lowerName] = {
      name: name,
      value: value
    }
  }
  
  ClientRequest.prototype.getHeader = function (name) {
    var header = this._headers[name.toLowerCase()]
    if (header)
      return header.value
    return null
  }
  
  ClientRequest.prototype.removeHeader = function (name) {
    var self = this
    delete self._headers[name.toLowerCase()]
  }
  
  ClientRequest.prototype._onFinish = function () {
    var self = this
  
    if (self._destroyed)
      return
    var opts = self._opts
  
    var headersObj = self._headers
    var body = null
    if (opts.method !== 'GET' && opts.method !== 'HEAD') {
          body = new Blob(self._body, {
              type: (headersObj['content-type'] || {}).value || ''
          });
      }
  
    // create flattened list of headers
    var headersList = []
    Object.keys(headersObj).forEach(function (keyName) {
      var name = headersObj[keyName].name
      var value = headersObj[keyName].value
      if (Array.isArray(value)) {
        value.forEach(function (v) {
          headersList.push([name, v])
        })
      } else {
        headersList.push([name, value])
      }
    })
  
    if (self._mode === 'fetch') {
      var signal = null
      if (capability.abortController) {
        var controller = new AbortController()
        signal = controller.signal
        self._fetchAbortController = controller
  
        if ('requestTimeout' in opts && opts.requestTimeout !== 0) {
          self._fetchTimer = global.setTimeout(function () {
            self.emit('requestTimeout')
            if (self._fetchAbortController)
              self._fetchAbortController.abort()
          }, opts.requestTimeout)
        }
      }
  
      global.fetch(self._opts.url, {
        method: self._opts.method,
        headers: headersList,
        body: body || undefined,
        mode: 'cors',
        credentials: opts.withCredentials ? 'include' : 'same-origin',
        signal: signal
      }).then(function (response) {
        self._fetchResponse = response
        self._connect()
      }, function (reason) {
        global.clearTimeout(self._fetchTimer)
        if (!self._destroyed)
          self.emit('error', reason)
      })
    } else {
      var xhr = self._xhr = new global.XMLHttpRequest()
      try {
        xhr.open(self._opts.method, self._opts.url, true)
      } catch (err) {
        process.nextTick(function () {
          self.emit('error', err)
        })
        return
      }
  
      // Can't set responseType on really old browsers
      if ('responseType' in xhr)
        xhr.responseType = self._mode
  
      if ('withCredentials' in xhr)
        xhr.withCredentials = !!opts.withCredentials
  
      if (self._mode === 'text' && 'overrideMimeType' in xhr)
        xhr.overrideMimeType('text/plain; charset=x-user-defined')
  
      if ('requestTimeout' in opts) {
        xhr.timeout = opts.requestTimeout
        xhr.ontimeout = function () {
          self.emit('requestTimeout')
        }
      }
  
      headersList.forEach(function (header) {
        xhr.setRequestHeader(header[0], header[1])
      })
  
      self._response = null
      xhr.onreadystatechange = function () {
        switch (xhr.readyState) {
          case rStates.LOADING:
          case rStates.DONE:
            self._onXHRProgress()
            break
        }
      }
      // Necessary for streaming in Firefox, since xhr.response is ONLY defined
      // in onprogress, not in onreadystatechange with xhr.readyState = 3
      if (self._mode === 'moz-chunked-arraybuffer') {
        xhr.onprogress = function () {
          self._onXHRProgress()
        }
      }
  
      xhr.onerror = function () {
        if (self._destroyed)
          return
        self.emit('error', new Error('XHR error'))
      }
  
      try {
        xhr.send(body)
      } catch (err) {
        process.nextTick(function () {
          self.emit('error', err)
        })
        return
      }
    }
  }
  
  /**
   * Checks if xhr.status is readable and non-zero, indicating no error.
   * Even though the spec says it should be available in readyState 3,
   * accessing it throws an exception in IE8
   */
  function statusValid (xhr) {
    try {
      var status = xhr.status
      return (status !== null && status !== 0)
    } catch (e) {
      return false
    }
  }
  
  ClientRequest.prototype._onXHRProgress = function () {
    var self = this
  
    if (!statusValid(self._xhr) || self._destroyed)
      return
  
    if (!self._response)
      self._connect()
  
    self._response._onXHRProgress()
  }
  
  ClientRequest.prototype._connect = function () {
    var self = this
  
    if (self._destroyed)
      return
  
    self._response = new IncomingMessage(self._xhr, self._fetchResponse, self._mode, self._fetchTimer)
    self._response.on('error', function(err) {
      self.emit('error', err)
    })
  
    self.emit('response', self._response)
  }
  
  ClientRequest.prototype._write = function (chunk, encoding, cb) {
    var self = this
  
    self._body.push(chunk)
    cb()
  }
  
  ClientRequest.prototype.abort = ClientRequest.prototype.destroy = function () {
    var self = this
    self._destroyed = true
    global.clearTimeout(self._fetchTimer)
    if (self._response)
      self._response._destroyed = true
    if (self._xhr)
      self._xhr.abort()
    else if (self._fetchAbortController)
      self._fetchAbortController.abort()
  }
  
  ClientRequest.prototype.end = function (data, encoding, cb) {
    var self = this
    if (typeof data === 'function') {
      cb = data
      data = undefined
    }
  
    stream.Writable.prototype.end.call(self, data, encoding, cb)
  }
  
  ClientRequest.prototype.flushHeaders = function () {}
  ClientRequest.prototype.setTimeout = function () {}
  ClientRequest.prototype.setNoDelay = function () {}
  ClientRequest.prototype.setSocketKeepAlive = function () {}
  
  // Taken from http://www.w3.org/TR/XMLHttpRequest/#the-setrequestheader%28%29-method
  var unsafeHeaders = [
    'accept-charset',
    'accept-encoding',
    'access-control-request-headers',
    'access-control-request-method',
    'connection',
    'content-length',
    'cookie',
    'cookie2',
    'date',
    'dnt',
    'expect',
    'host',
    'keep-alive',
    'origin',
    'referer',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'via'
  ]
  
  }).call(this)}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer)
  },{"./capability":18,"./response":20,"_process":11,"buffer":3,"inherits":8,"readable-stream":35}],20:[function(require,module,exports){
  (function (process,global,Buffer){(function (){
  var capability = require('./capability')
  var inherits = require('inherits')
  var stream = require('readable-stream')
  
  var rStates = exports.readyStates = {
    UNSENT: 0,
    OPENED: 1,
    HEADERS_RECEIVED: 2,
    LOADING: 3,
    DONE: 4
  }
  
  var IncomingMessage = exports.IncomingMessage = function (xhr, response, mode, fetchTimer) {
    var self = this
    stream.Readable.call(self)
  
    self._mode = mode
    self.headers = {}
    self.rawHeaders = []
    self.trailers = {}
    self.rawTrailers = []
  
    // Fake the 'close' event, but only once 'end' fires
    self.on('end', function () {
      // The nextTick is necessary to prevent the 'request' module from causing an infinite loop
      process.nextTick(function () {
        self.emit('close')
      })
    })
  
    if (mode === 'fetch') {
      self._fetchResponse = response
  
      self.url = response.url
      self.statusCode = response.status
      self.statusMessage = response.statusText
      
      response.headers.forEach(function (header, key){
        self.headers[key.toLowerCase()] = header
        self.rawHeaders.push(key, header)
      })
  
      if (capability.writableStream) {
        var writable = new WritableStream({
          write: function (chunk) {
            return new Promise(function (resolve, reject) {
              if (self._destroyed) {
                reject()
              } else if(self.push(Buffer.from(chunk))) {
                resolve()
              } else {
                self._resumeFetch = resolve
              }
            })
          },
          close: function () {
            global.clearTimeout(fetchTimer)
            if (!self._destroyed)
              self.push(null)
          },
          abort: function (err) {
            if (!self._destroyed)
              self.emit('error', err)
          }
        })
  
        try {
          response.body.pipeTo(writable).catch(function (err) {
            global.clearTimeout(fetchTimer)
            if (!self._destroyed)
              self.emit('error', err)
          })
          return
        } catch (e) {} // pipeTo method isn't defined. Can't find a better way to feature test this
      }
      // fallback for when writableStream or pipeTo aren't available
      var reader = response.body.getReader()
      function read () {
        reader.read().then(function (result) {
          if (self._destroyed)
            return
          if (result.done) {
            global.clearTimeout(fetchTimer)
            self.push(null)
            return
          }
          self.push(Buffer.from(result.value))
          read()
        }).catch(function (err) {
          global.clearTimeout(fetchTimer)
          if (!self._destroyed)
            self.emit('error', err)
        })
      }
      read()
    } else {
      self._xhr = xhr
      self._pos = 0
  
      self.url = xhr.responseURL
      self.statusCode = xhr.status
      self.statusMessage = xhr.statusText
      var headers = xhr.getAllResponseHeaders().split(/\r?\n/)
      headers.forEach(function (header) {
        var matches = header.match(/^([^:]+):\s*(.*)/)
        if (matches) {
          var key = matches[1].toLowerCase()
          if (key === 'set-cookie') {
            if (self.headers[key] === undefined) {
              self.headers[key] = []
            }
            self.headers[key].push(matches[2])
          } else if (self.headers[key] !== undefined) {
            self.headers[key] += ', ' + matches[2]
          } else {
            self.headers[key] = matches[2]
          }
          self.rawHeaders.push(matches[1], matches[2])
        }
      })
  
      self._charset = 'x-user-defined'
      if (!capability.overrideMimeType) {
        var mimeType = self.rawHeaders['mime-type']
        if (mimeType) {
          var charsetMatch = mimeType.match(/;\s*charset=([^;])(;|$)/)
          if (charsetMatch) {
            self._charset = charsetMatch[1].toLowerCase()
          }
        }
        if (!self._charset)
          self._charset = 'utf-8' // best guess
      }
    }
  }
  
  inherits(IncomingMessage, stream.Readable)
  
  IncomingMessage.prototype._read = function () {
    var self = this
  
    var resolve = self._resumeFetch
    if (resolve) {
      self._resumeFetch = null
      resolve()
    }
  }
  
  IncomingMessage.prototype._onXHRProgress = function () {
    var self = this
  
    var xhr = self._xhr
  
    var response = null
    switch (self._mode) {
      case 'text':
        response = xhr.responseText
        if (response.length > self._pos) {
          var newData = response.substr(self._pos)
          if (self._charset === 'x-user-defined') {
            var buffer = Buffer.alloc(newData.length)
            for (var i = 0; i < newData.length; i++)
              buffer[i] = newData.charCodeAt(i) & 0xff
  
            self.push(buffer)
          } else {
            self.push(newData, self._charset)
          }
          self._pos = response.length
        }
        break
      case 'arraybuffer':
        if (xhr.readyState !== rStates.DONE || !xhr.response)
          break
        response = xhr.response
        self.push(Buffer.from(new Uint8Array(response)))
        break
      case 'moz-chunked-arraybuffer': // take whole
        response = xhr.response
        if (xhr.readyState !== rStates.LOADING || !response)
          break
        self.push(Buffer.from(new Uint8Array(response)))
        break
      case 'ms-stream':
        response = xhr.response
        if (xhr.readyState !== rStates.LOADING)
          break
        var reader = new global.MSStreamReader()
        reader.onprogress = function () {
          if (reader.result.byteLength > self._pos) {
            self.push(Buffer.from(new Uint8Array(reader.result.slice(self._pos))))
            self._pos = reader.result.byteLength
          }
        }
        reader.onload = function () {
          self.push(null)
        }
        // reader.onerror = ??? // TODO: this
        reader.readAsArrayBuffer(response)
        break
    }
  
    // The ms-stream case handles end separately in reader.onload()
    if (self._xhr.readyState === rStates.DONE && self._mode !== 'ms-stream') {
      self.push(null)
    }
  }
  
  }).call(this)}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer)
  },{"./capability":18,"_process":11,"buffer":3,"inherits":8,"readable-stream":35}],21:[function(require,module,exports){
  'use strict';
  
  function _inheritsLoose(subClass, superClass) { subClass.prototype = Object.create(superClass.prototype); subClass.prototype.constructor = subClass; subClass.__proto__ = superClass; }
  
  var codes = {};
  
  function createErrorType(code, message, Base) {
    if (!Base) {
      Base = Error;
    }
  
    function getMessage(arg1, arg2, arg3) {
      if (typeof message === 'string') {
        return message;
      } else {
        return message(arg1, arg2, arg3);
      }
    }
  
    var NodeError =
    /*#__PURE__*/
    function (_Base) {
      _inheritsLoose(NodeError, _Base);
  
      function NodeError(arg1, arg2, arg3) {
        return _Base.call(this, getMessage(arg1, arg2, arg3)) || this;
      }
  
      return NodeError;
    }(Base);
  
    NodeError.prototype.name = Base.name;
    NodeError.prototype.code = code;
    codes[code] = NodeError;
  } // https://github.com/nodejs/node/blob/v10.8.0/lib/internal/errors.js
  
  
  function oneOf(expected, thing) {
    if (Array.isArray(expected)) {
      var len = expected.length;
      expected = expected.map(function (i) {
        return String(i);
      });
  
      if (len > 2) {
        return "one of ".concat(thing, " ").concat(expected.slice(0, len - 1).join(', '), ", or ") + expected[len - 1];
      } else if (len === 2) {
        return "one of ".concat(thing, " ").concat(expected[0], " or ").concat(expected[1]);
      } else {
        return "of ".concat(thing, " ").concat(expected[0]);
      }
    } else {
      return "of ".concat(thing, " ").concat(String(expected));
    }
  } // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/startsWith
  
  
  function startsWith(str, search, pos) {
    return str.substr(!pos || pos < 0 ? 0 : +pos, search.length) === search;
  } // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/endsWith
  
  
  function endsWith(str, search, this_len) {
    if (this_len === undefined || this_len > str.length) {
      this_len = str.length;
    }
  
    return str.substring(this_len - search.length, this_len) === search;
  } // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/includes
  
  
  function includes(str, search, start) {
    if (typeof start !== 'number') {
      start = 0;
    }
  
    if (start + search.length > str.length) {
      return false;
    } else {
      return str.indexOf(search, start) !== -1;
    }
  }
  
  createErrorType('ERR_INVALID_OPT_VALUE', function (name, value) {
    return 'The value "' + value + '" is invalid for option "' + name + '"';
  }, TypeError);
  createErrorType('ERR_INVALID_ARG_TYPE', function (name, expected, actual) {
    // determiner: 'must be' or 'must not be'
    var determiner;
  
    if (typeof expected === 'string' && startsWith(expected, 'not ')) {
      determiner = 'must not be';
      expected = expected.replace(/^not /, '');
    } else {
      determiner = 'must be';
    }
  
    var msg;
  
    if (endsWith(name, ' argument')) {
      // For cases like 'first argument'
      msg = "The ".concat(name, " ").concat(determiner, " ").concat(oneOf(expected, 'type'));
    } else {
      var type = includes(name, '.') ? 'property' : 'argument';
      msg = "The \"".concat(name, "\" ").concat(type, " ").concat(determiner, " ").concat(oneOf(expected, 'type'));
    }
  
    msg += ". Received type ".concat(typeof actual);
    return msg;
  }, TypeError);
  createErrorType('ERR_STREAM_PUSH_AFTER_EOF', 'stream.push() after EOF');
  createErrorType('ERR_METHOD_NOT_IMPLEMENTED', function (name) {
    return 'The ' + name + ' method is not implemented';
  });
  createErrorType('ERR_STREAM_PREMATURE_CLOSE', 'Premature close');
  createErrorType('ERR_STREAM_DESTROYED', function (name) {
    return 'Cannot call ' + name + ' after a stream was destroyed';
  });
  createErrorType('ERR_MULTIPLE_CALLBACK', 'Callback called multiple times');
  createErrorType('ERR_STREAM_CANNOT_PIPE', 'Cannot pipe, not readable');
  createErrorType('ERR_STREAM_WRITE_AFTER_END', 'write after end');
  createErrorType('ERR_STREAM_NULL_VALUES', 'May not write null values to stream', TypeError);
  createErrorType('ERR_UNKNOWN_ENCODING', function (arg) {
    return 'Unknown encoding: ' + arg;
  }, TypeError);
  createErrorType('ERR_STREAM_UNSHIFT_AFTER_END_EVENT', 'stream.unshift() after end event');
  module.exports.codes = codes;
  
  },{}],22:[function(require,module,exports){
  (function (process){(function (){
  // Copyright Joyent, Inc. and other Node contributors.
  //
  // Permission is hereby granted, free of charge, to any person obtaining a
  // copy of this software and associated documentation files (the
  // "Software"), to deal in the Software without restriction, including
  // without limitation the rights to use, copy, modify, merge, publish,
  // distribute, sublicense, and/or sell copies of the Software, and to permit
  // persons to whom the Software is furnished to do so, subject to the
  // following conditions:
  //
  // The above copyright notice and this permission notice shall be included
  // in all copies or substantial portions of the Software.
  //
  // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
  // OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  // MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
  // NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
  // DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  // OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
  // USE OR OTHER DEALINGS IN THE SOFTWARE.
  // a duplex stream is just a stream that is both readable and writable.
  // Since JS doesn't have multiple prototypal inheritance, this class
  // prototypally inherits from Readable, and then parasitically from
  // Writable.
  'use strict';
  /*<replacement>*/
  
  var objectKeys = Object.keys || function (obj) {
    var keys = [];
  
    for (var key in obj) {
      keys.push(key);
    }
  
    return keys;
  };
  /*</replacement>*/
  
  
  module.exports = Duplex;
  
  var Readable = require('./_stream_readable');
  
  var Writable = require('./_stream_writable');
  
  require('inherits')(Duplex, Readable);
  
  {
    // Allow the keys array to be GC'ed.
    var keys = objectKeys(Writable.prototype);
  
    for (var v = 0; v < keys.length; v++) {
      var method = keys[v];
      if (!Duplex.prototype[method]) Duplex.prototype[method] = Writable.prototype[method];
    }
  }
  
  function Duplex(options) {
    if (!(this instanceof Duplex)) return new Duplex(options);
    Readable.call(this, options);
    Writable.call(this, options);
    this.allowHalfOpen = true;
  
    if (options) {
      if (options.readable === false) this.readable = false;
      if (options.writable === false) this.writable = false;
  
      if (options.allowHalfOpen === false) {
        this.allowHalfOpen = false;
        this.once('end', onend);
      }
    }
  }
  
  Object.defineProperty(Duplex.prototype, 'writableHighWaterMark', {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      return this._writableState.highWaterMark;
    }
  });
  Object.defineProperty(Duplex.prototype, 'writableBuffer', {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      return this._writableState && this._writableState.getBuffer();
    }
  });
  Object.defineProperty(Duplex.prototype, 'writableLength', {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      return this._writableState.length;
    }
  }); // the no-half-open enforcer
  
  function onend() {
    // If the writable side ended, then we're ok.
    if (this._writableState.ended) return; // no more data can be written.
    // But allow more writes to happen in this tick.
  
    process.nextTick(onEndNT, this);
  }
  
  function onEndNT(self) {
    self.end();
  }
  
  Object.defineProperty(Duplex.prototype, 'destroyed', {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      if (this._readableState === undefined || this._writableState === undefined) {
        return false;
      }
  
      return this._readableState.destroyed && this._writableState.destroyed;
    },
    set: function set(value) {
      // we ignore the value if the stream
      // has not been initialized yet
      if (this._readableState === undefined || this._writableState === undefined) {
        return;
      } // backward compatibility, the user is explicitly
      // managing destroyed
  
  
      this._readableState.destroyed = value;
      this._writableState.destroyed = value;
    }
  });
  }).call(this)}).call(this,require('_process'))
  },{"./_stream_readable":24,"./_stream_writable":26,"_process":11,"inherits":8}],23:[function(require,module,exports){
  // Copyright Joyent, Inc. and other Node contributors.
  //
  // Permission is hereby granted, free of charge, to any person obtaining a
  // copy of this software and associated documentation files (the
  // "Software"), to deal in the Software without restriction, including
  // without limitation the rights to use, copy, modify, merge, publish,
  // distribute, sublicense, and/or sell copies of the Software, and to permit
  // persons to whom the Software is furnished to do so, subject to the
  // following conditions:
  //
  // The above copyright notice and this permission notice shall be included
  // in all copies or substantial portions of the Software.
  //
  // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
  // OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  // MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
  // NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
  // DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  // OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
  // USE OR OTHER DEALINGS IN THE SOFTWARE.
  // a passthrough stream.
  // basically just the most minimal sort of Transform stream.
  // Every written chunk gets output as-is.
  'use strict';
  
  module.exports = PassThrough;
  
  var Transform = require('./_stream_transform');
  
  require('inherits')(PassThrough, Transform);
  
  function PassThrough(options) {
    if (!(this instanceof PassThrough)) return new PassThrough(options);
    Transform.call(this, options);
  }
  
  PassThrough.prototype._transform = function (chunk, encoding, cb) {
    cb(null, chunk);
  };
  },{"./_stream_transform":25,"inherits":8}],24:[function(require,module,exports){
  (function (process,global){(function (){
  // Copyright Joyent, Inc. and other Node contributors.
  //
  // Permission is hereby granted, free of charge, to any person obtaining a
  // copy of this software and associated documentation files (the
  // "Software"), to deal in the Software without restriction, including
  // without limitation the rights to use, copy, modify, merge, publish,
  // distribute, sublicense, and/or sell copies of the Software, and to permit
  // persons to whom the Software is furnished to do so, subject to the
  // following conditions:
  //
  // The above copyright notice and this permission notice shall be included
  // in all copies or substantial portions of the Software.
  //
  // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
  // OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  // MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
  // NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
  // DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  // OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
  // USE OR OTHER DEALINGS IN THE SOFTWARE.
  'use strict';
  
  module.exports = Readable;
  /*<replacement>*/
  
  var Duplex;
  /*</replacement>*/
  
  Readable.ReadableState = ReadableState;
  /*<replacement>*/
  
  var EE = require('events').EventEmitter;
  
  var EElistenerCount = function EElistenerCount(emitter, type) {
    return emitter.listeners(type).length;
  };
  /*</replacement>*/
  
  /*<replacement>*/
  
  
  var Stream = require('./internal/streams/stream');
  /*</replacement>*/
  
  
  var Buffer = require('buffer').Buffer;
  
  var OurUint8Array = global.Uint8Array || function () {};
  
  function _uint8ArrayToBuffer(chunk) {
    return Buffer.from(chunk);
  }
  
  function _isUint8Array(obj) {
    return Buffer.isBuffer(obj) || obj instanceof OurUint8Array;
  }
  /*<replacement>*/
  
  
  var debugUtil = require('util');
  
  var debug;
  
  if (debugUtil && debugUtil.debuglog) {
    debug = debugUtil.debuglog('stream');
  } else {
    debug = function debug() {};
  }
  /*</replacement>*/
  
  
  var BufferList = require('./internal/streams/buffer_list');
  
  var destroyImpl = require('./internal/streams/destroy');
  
  var _require = require('./internal/streams/state'),
      getHighWaterMark = _require.getHighWaterMark;
  
  var _require$codes = require('../errors').codes,
      ERR_INVALID_ARG_TYPE = _require$codes.ERR_INVALID_ARG_TYPE,
      ERR_STREAM_PUSH_AFTER_EOF = _require$codes.ERR_STREAM_PUSH_AFTER_EOF,
      ERR_METHOD_NOT_IMPLEMENTED = _require$codes.ERR_METHOD_NOT_IMPLEMENTED,
      ERR_STREAM_UNSHIFT_AFTER_END_EVENT = _require$codes.ERR_STREAM_UNSHIFT_AFTER_END_EVENT; // Lazy loaded to improve the startup performance.
  
  
  var StringDecoder;
  var createReadableStreamAsyncIterator;
  var from;
  
  require('inherits')(Readable, Stream);
  
  var errorOrDestroy = destroyImpl.errorOrDestroy;
  var kProxyEvents = ['error', 'close', 'destroy', 'pause', 'resume'];
  
  function prependListener(emitter, event, fn) {
    // Sadly this is not cacheable as some libraries bundle their own
    // event emitter implementation with them.
    if (typeof emitter.prependListener === 'function') return emitter.prependListener(event, fn); // This is a hack to make sure that our error handler is attached before any
    // userland ones.  NEVER DO THIS. This is here only because this code needs
    // to continue to work with older versions of Node.js that do not include
    // the prependListener() method. The goal is to eventually remove this hack.
  
    if (!emitter._events || !emitter._events[event]) emitter.on(event, fn);else if (Array.isArray(emitter._events[event])) emitter._events[event].unshift(fn);else emitter._events[event] = [fn, emitter._events[event]];
  }
  
  function ReadableState(options, stream, isDuplex) {
    Duplex = Duplex || require('./_stream_duplex');
    options = options || {}; // Duplex streams are both readable and writable, but share
    // the same options object.
    // However, some cases require setting options to different
    // values for the readable and the writable sides of the duplex stream.
    // These options can be provided separately as readableXXX and writableXXX.
  
    if (typeof isDuplex !== 'boolean') isDuplex = stream instanceof Duplex; // object stream flag. Used to make read(n) ignore n and to
    // make all the buffer merging and length checks go away
  
    this.objectMode = !!options.objectMode;
    if (isDuplex) this.objectMode = this.objectMode || !!options.readableObjectMode; // the point at which it stops calling _read() to fill the buffer
    // Note: 0 is a valid value, means "don't call _read preemptively ever"
  
    this.highWaterMark = getHighWaterMark(this, options, 'readableHighWaterMark', isDuplex); // A linked list is used to store data chunks instead of an array because the
    // linked list can remove elements from the beginning faster than
    // array.shift()
  
    this.buffer = new BufferList();
    this.length = 0;
    this.pipes = null;
    this.pipesCount = 0;
    this.flowing = null;
    this.ended = false;
    this.endEmitted = false;
    this.reading = false; // a flag to be able to tell if the event 'readable'/'data' is emitted
    // immediately, or on a later tick.  We set this to true at first, because
    // any actions that shouldn't happen until "later" should generally also
    // not happen before the first read call.
  
    this.sync = true; // whenever we return null, then we set a flag to say
    // that we're awaiting a 'readable' event emission.
  
    this.needReadable = false;
    this.emittedReadable = false;
    this.readableListening = false;
    this.resumeScheduled = false;
    this.paused = true; // Should close be emitted on destroy. Defaults to true.
  
    this.emitClose = options.emitClose !== false; // Should .destroy() be called after 'end' (and potentially 'finish')
  
    this.autoDestroy = !!options.autoDestroy; // has it been destroyed
  
    this.destroyed = false; // Crypto is kind of old and crusty.  Historically, its default string
    // encoding is 'binary' so we have to make this configurable.
    // Everything else in the universe uses 'utf8', though.
  
    this.defaultEncoding = options.defaultEncoding || 'utf8'; // the number of writers that are awaiting a drain event in .pipe()s
  
    this.awaitDrain = 0; // if true, a maybeReadMore has been scheduled
  
    this.readingMore = false;
    this.decoder = null;
    this.encoding = null;
  
    if (options.encoding) {
      if (!StringDecoder) StringDecoder = require('string_decoder/').StringDecoder;
      this.decoder = new StringDecoder(options.encoding);
      this.encoding = options.encoding;
    }
  }
  
  function Readable(options) {
    Duplex = Duplex || require('./_stream_duplex');
    if (!(this instanceof Readable)) return new Readable(options); // Checking for a Stream.Duplex instance is faster here instead of inside
    // the ReadableState constructor, at least with V8 6.5
  
    var isDuplex = this instanceof Duplex;
    this._readableState = new ReadableState(options, this, isDuplex); // legacy
  
    this.readable = true;
  
    if (options) {
      if (typeof options.read === 'function') this._read = options.read;
      if (typeof options.destroy === 'function') this._destroy = options.destroy;
    }
  
    Stream.call(this);
  }
  
  Object.defineProperty(Readable.prototype, 'destroyed', {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      if (this._readableState === undefined) {
        return false;
      }
  
      return this._readableState.destroyed;
    },
    set: function set(value) {
      // we ignore the value if the stream
      // has not been initialized yet
      if (!this._readableState) {
        return;
      } // backward compatibility, the user is explicitly
      // managing destroyed
  
  
      this._readableState.destroyed = value;
    }
  });
  Readable.prototype.destroy = destroyImpl.destroy;
  Readable.prototype._undestroy = destroyImpl.undestroy;
  
  Readable.prototype._destroy = function (err, cb) {
    cb(err);
  }; // Manually shove something into the read() buffer.
  // This returns true if the highWaterMark has not been hit yet,
  // similar to how Writable.write() returns true if you should
  // write() some more.
  
  
  Readable.prototype.push = function (chunk, encoding) {
    var state = this._readableState;
    var skipChunkCheck;
  
    if (!state.objectMode) {
      if (typeof chunk === 'string') {
        encoding = encoding || state.defaultEncoding;
  
        if (encoding !== state.encoding) {
          chunk = Buffer.from(chunk, encoding);
          encoding = '';
        }
  
        skipChunkCheck = true;
      }
    } else {
      skipChunkCheck = true;
    }
  
    return readableAddChunk(this, chunk, encoding, false, skipChunkCheck);
  }; // Unshift should *always* be something directly out of read()
  
  
  Readable.prototype.unshift = function (chunk) {
    return readableAddChunk(this, chunk, null, true, false);
  };
  
  function readableAddChunk(stream, chunk, encoding, addToFront, skipChunkCheck) {
    debug('readableAddChunk', chunk);
    var state = stream._readableState;
  
    if (chunk === null) {
      state.reading = false;
      onEofChunk(stream, state);
    } else {
      var er;
      if (!skipChunkCheck) er = chunkInvalid(state, chunk);
  
      if (er) {
        errorOrDestroy(stream, er);
      } else if (state.objectMode || chunk && chunk.length > 0) {
        if (typeof chunk !== 'string' && !state.objectMode && Object.getPrototypeOf(chunk) !== Buffer.prototype) {
          chunk = _uint8ArrayToBuffer(chunk);
        }
  
        if (addToFront) {
          if (state.endEmitted) errorOrDestroy(stream, new ERR_STREAM_UNSHIFT_AFTER_END_EVENT());else addChunk(stream, state, chunk, true);
        } else if (state.ended) {
          errorOrDestroy(stream, new ERR_STREAM_PUSH_AFTER_EOF());
        } else if (state.destroyed) {
          return false;
        } else {
          state.reading = false;
  
          if (state.decoder && !encoding) {
            chunk = state.decoder.write(chunk);
            if (state.objectMode || chunk.length !== 0) addChunk(stream, state, chunk, false);else maybeReadMore(stream, state);
          } else {
            addChunk(stream, state, chunk, false);
          }
        }
      } else if (!addToFront) {
        state.reading = false;
        maybeReadMore(stream, state);
      }
    } // We can push more data if we are below the highWaterMark.
    // Also, if we have no data yet, we can stand some more bytes.
    // This is to work around cases where hwm=0, such as the repl.
  
  
    return !state.ended && (state.length < state.highWaterMark || state.length === 0);
  }
  
  function addChunk(stream, state, chunk, addToFront) {
    if (state.flowing && state.length === 0 && !state.sync) {
      state.awaitDrain = 0;
      stream.emit('data', chunk);
    } else {
      // update the buffer info.
      state.length += state.objectMode ? 1 : chunk.length;
      if (addToFront) state.buffer.unshift(chunk);else state.buffer.push(chunk);
      if (state.needReadable) emitReadable(stream);
    }
  
    maybeReadMore(stream, state);
  }
  
  function chunkInvalid(state, chunk) {
    var er;
  
    if (!_isUint8Array(chunk) && typeof chunk !== 'string' && chunk !== undefined && !state.objectMode) {
      er = new ERR_INVALID_ARG_TYPE('chunk', ['string', 'Buffer', 'Uint8Array'], chunk);
    }
  
    return er;
  }
  
  Readable.prototype.isPaused = function () {
    return this._readableState.flowing === false;
  }; // backwards compatibility.
  
  
  Readable.prototype.setEncoding = function (enc) {
    if (!StringDecoder) StringDecoder = require('string_decoder/').StringDecoder;
    var decoder = new StringDecoder(enc);
    this._readableState.decoder = decoder; // If setEncoding(null), decoder.encoding equals utf8
  
    this._readableState.encoding = this._readableState.decoder.encoding; // Iterate over current buffer to convert already stored Buffers:
  
    var p = this._readableState.buffer.head;
    var content = '';
  
    while (p !== null) {
      content += decoder.write(p.data);
      p = p.next;
    }
  
    this._readableState.buffer.clear();
  
    if (content !== '') this._readableState.buffer.push(content);
    this._readableState.length = content.length;
    return this;
  }; // Don't raise the hwm > 1GB
  
  
  var MAX_HWM = 0x40000000;
  
  function computeNewHighWaterMark(n) {
    if (n >= MAX_HWM) {
      // TODO(ronag): Throw ERR_VALUE_OUT_OF_RANGE.
      n = MAX_HWM;
    } else {
      // Get the next highest power of 2 to prevent increasing hwm excessively in
      // tiny amounts
      n--;
      n |= n >>> 1;
      n |= n >>> 2;
      n |= n >>> 4;
      n |= n >>> 8;
      n |= n >>> 16;
      n++;
    }
  
    return n;
  } // This function is designed to be inlinable, so please take care when making
  // changes to the function body.
  
  
  function howMuchToRead(n, state) {
    if (n <= 0 || state.length === 0 && state.ended) return 0;
    if (state.objectMode) return 1;
  
    if (n !== n) {
      // Only flow one buffer at a time
      if (state.flowing && state.length) return state.buffer.head.data.length;else return state.length;
    } // If we're asking for more than the current hwm, then raise the hwm.
  
  
    if (n > state.highWaterMark) state.highWaterMark = computeNewHighWaterMark(n);
    if (n <= state.length) return n; // Don't have enough
  
    if (!state.ended) {
      state.needReadable = true;
      return 0;
    }
  
    return state.length;
  } // you can override either this method, or the async _read(n) below.
  
  
  Readable.prototype.read = function (n) {
    debug('read', n);
    n = parseInt(n, 10);
    var state = this._readableState;
    var nOrig = n;
    if (n !== 0) state.emittedReadable = false; // if we're doing read(0) to trigger a readable event, but we
    // already have a bunch of data in the buffer, then just trigger
    // the 'readable' event and move on.
  
    if (n === 0 && state.needReadable && ((state.highWaterMark !== 0 ? state.length >= state.highWaterMark : state.length > 0) || state.ended)) {
      debug('read: emitReadable', state.length, state.ended);
      if (state.length === 0 && state.ended) endReadable(this);else emitReadable(this);
      return null;
    }
  
    n = howMuchToRead(n, state); // if we've ended, and we're now clear, then finish it up.
  
    if (n === 0 && state.ended) {
      if (state.length === 0) endReadable(this);
      return null;
    } // All the actual chunk generation logic needs to be
    // *below* the call to _read.  The reason is that in certain
    // synthetic stream cases, such as passthrough streams, _read
    // may be a completely synchronous operation which may change
    // the state of the read buffer, providing enough data when
    // before there was *not* enough.
    //
    // So, the steps are:
    // 1. Figure out what the state of things will be after we do
    // a read from the buffer.
    //
    // 2. If that resulting state will trigger a _read, then call _read.
    // Note that this may be asynchronous, or synchronous.  Yes, it is
    // deeply ugly to write APIs this way, but that still doesn't mean
    // that the Readable class should behave improperly, as streams are
    // designed to be sync/async agnostic.
    // Take note if the _read call is sync or async (ie, if the read call
    // has returned yet), so that we know whether or not it's safe to emit
    // 'readable' etc.
    //
    // 3. Actually pull the requested chunks out of the buffer and return.
    // if we need a readable event, then we need to do some reading.
  
  
    var doRead = state.needReadable;
    debug('need readable', doRead); // if we currently have less than the highWaterMark, then also read some
  
    if (state.length === 0 || state.length - n < state.highWaterMark) {
      doRead = true;
      debug('length less than watermark', doRead);
    } // however, if we've ended, then there's no point, and if we're already
    // reading, then it's unnecessary.
  
  
    if (state.ended || state.reading) {
      doRead = false;
      debug('reading or ended', doRead);
    } else if (doRead) {
      debug('do read');
      state.reading = true;
      state.sync = true; // if the length is currently zero, then we *need* a readable event.
  
      if (state.length === 0) state.needReadable = true; // call internal read method
  
      this._read(state.highWaterMark);
  
      state.sync = false; // If _read pushed data synchronously, then `reading` will be false,
      // and we need to re-evaluate how much data we can return to the user.
  
      if (!state.reading) n = howMuchToRead(nOrig, state);
    }
  
    var ret;
    if (n > 0) ret = fromList(n, state);else ret = null;
  
    if (ret === null) {
      state.needReadable = state.length <= state.highWaterMark;
      n = 0;
    } else {
      state.length -= n;
      state.awaitDrain = 0;
    }
  
    if (state.length === 0) {
      // If we have nothing in the buffer, then we want to know
      // as soon as we *do* get something into the buffer.
      if (!state.ended) state.needReadable = true; // If we tried to read() past the EOF, then emit end on the next tick.
  
      if (nOrig !== n && state.ended) endReadable(this);
    }
  
    if (ret !== null) this.emit('data', ret);
    return ret;
  };
  
  function onEofChunk(stream, state) {
    debug('onEofChunk');
    if (state.ended) return;
  
    if (state.decoder) {
      var chunk = state.decoder.end();
  
      if (chunk && chunk.length) {
        state.buffer.push(chunk);
        state.length += state.objectMode ? 1 : chunk.length;
      }
    }
  
    state.ended = true;
  
    if (state.sync) {
      // if we are sync, wait until next tick to emit the data.
      // Otherwise we risk emitting data in the flow()
      // the readable code triggers during a read() call
      emitReadable(stream);
    } else {
      // emit 'readable' now to make sure it gets picked up.
      state.needReadable = false;
  
      if (!state.emittedReadable) {
        state.emittedReadable = true;
        emitReadable_(stream);
      }
    }
  } // Don't emit readable right away in sync mode, because this can trigger
  // another read() call => stack overflow.  This way, it might trigger
  // a nextTick recursion warning, but that's not so bad.
  
  
  function emitReadable(stream) {
    var state = stream._readableState;
    debug('emitReadable', state.needReadable, state.emittedReadable);
    state.needReadable = false;
  
    if (!state.emittedReadable) {
      debug('emitReadable', state.flowing);
      state.emittedReadable = true;
      process.nextTick(emitReadable_, stream);
    }
  }
  
  function emitReadable_(stream) {
    var state = stream._readableState;
    debug('emitReadable_', state.destroyed, state.length, state.ended);
  
    if (!state.destroyed && (state.length || state.ended)) {
      stream.emit('readable');
      state.emittedReadable = false;
    } // The stream needs another readable event if
    // 1. It is not flowing, as the flow mechanism will take
    //    care of it.
    // 2. It is not ended.
    // 3. It is below the highWaterMark, so we can schedule
    //    another readable later.
  
  
    state.needReadable = !state.flowing && !state.ended && state.length <= state.highWaterMark;
    flow(stream);
  } // at this point, the user has presumably seen the 'readable' event,
  // and called read() to consume some data.  that may have triggered
  // in turn another _read(n) call, in which case reading = true if
  // it's in progress.
  // However, if we're not ended, or reading, and the length < hwm,
  // then go ahead and try to read some more preemptively.
  
  
  function maybeReadMore(stream, state) {
    if (!state.readingMore) {
      state.readingMore = true;
      process.nextTick(maybeReadMore_, stream, state);
    }
  }
  
  function maybeReadMore_(stream, state) {
    // Attempt to read more data if we should.
    //
    // The conditions for reading more data are (one of):
    // - Not enough data buffered (state.length < state.highWaterMark). The loop
    //   is responsible for filling the buffer with enough data if such data
    //   is available. If highWaterMark is 0 and we are not in the flowing mode
    //   we should _not_ attempt to buffer any extra data. We'll get more data
    //   when the stream consumer calls read() instead.
    // - No data in the buffer, and the stream is in flowing mode. In this mode
    //   the loop below is responsible for ensuring read() is called. Failing to
    //   call read here would abort the flow and there's no other mechanism for
    //   continuing the flow if the stream consumer has just subscribed to the
    //   'data' event.
    //
    // In addition to the above conditions to keep reading data, the following
    // conditions prevent the data from being read:
    // - The stream has ended (state.ended).
    // - There is already a pending 'read' operation (state.reading). This is a
    //   case where the the stream has called the implementation defined _read()
    //   method, but they are processing the call asynchronously and have _not_
    //   called push() with new data. In this case we skip performing more
    //   read()s. The execution ends in this method again after the _read() ends
    //   up calling push() with more data.
    while (!state.reading && !state.ended && (state.length < state.highWaterMark || state.flowing && state.length === 0)) {
      var len = state.length;
      debug('maybeReadMore read 0');
      stream.read(0);
      if (len === state.length) // didn't get any data, stop spinning.
        break;
    }
  
    state.readingMore = false;
  } // abstract method.  to be overridden in specific implementation classes.
  // call cb(er, data) where data is <= n in length.
  // for virtual (non-string, non-buffer) streams, "length" is somewhat
  // arbitrary, and perhaps not very meaningful.
  
  
  Readable.prototype._read = function (n) {
    errorOrDestroy(this, new ERR_METHOD_NOT_IMPLEMENTED('_read()'));
  };
  
  Readable.prototype.pipe = function (dest, pipeOpts) {
    var src = this;
    var state = this._readableState;
  
    switch (state.pipesCount) {
      case 0:
        state.pipes = dest;
        break;
  
      case 1:
        state.pipes = [state.pipes, dest];
        break;
  
      default:
        state.pipes.push(dest);
        break;
    }
  
    state.pipesCount += 1;
    debug('pipe count=%d opts=%j', state.pipesCount, pipeOpts);
    var doEnd = (!pipeOpts || pipeOpts.end !== false) && dest !== process.stdout && dest !== process.stderr;
    var endFn = doEnd ? onend : unpipe;
    if (state.endEmitted) process.nextTick(endFn);else src.once('end', endFn);
    dest.on('unpipe', onunpipe);
  
    function onunpipe(readable, unpipeInfo) {
      debug('onunpipe');
  
      if (readable === src) {
        if (unpipeInfo && unpipeInfo.hasUnpiped === false) {
          unpipeInfo.hasUnpiped = true;
          cleanup();
        }
      }
    }
  
    function onend() {
      debug('onend');
      dest.end();
    } // when the dest drains, it reduces the awaitDrain counter
    // on the source.  This would be more elegant with a .once()
    // handler in flow(), but adding and removing repeatedly is
    // too slow.
  
  
    var ondrain = pipeOnDrain(src);
    dest.on('drain', ondrain);
    var cleanedUp = false;
  
    function cleanup() {
      debug('cleanup'); // cleanup event handlers once the pipe is broken
  
      dest.removeListener('close', onclose);
      dest.removeListener('finish', onfinish);
      dest.removeListener('drain', ondrain);
      dest.removeListener('error', onerror);
      dest.removeListener('unpipe', onunpipe);
      src.removeListener('end', onend);
      src.removeListener('end', unpipe);
      src.removeListener('data', ondata);
      cleanedUp = true; // if the reader is waiting for a drain event from this
      // specific writer, then it would cause it to never start
      // flowing again.
      // So, if this is awaiting a drain, then we just call it now.
      // If we don't know, then assume that we are waiting for one.
  
      if (state.awaitDrain && (!dest._writableState || dest._writableState.needDrain)) ondrain();
    }
  
    src.on('data', ondata);
  
    function ondata(chunk) {
      debug('ondata');
      var ret = dest.write(chunk);
      debug('dest.write', ret);
  
      if (ret === false) {
        // If the user unpiped during `dest.write()`, it is possible
        // to get stuck in a permanently paused state if that write
        // also returned false.
        // => Check whether `dest` is still a piping destination.
        if ((state.pipesCount === 1 && state.pipes === dest || state.pipesCount > 1 && indexOf(state.pipes, dest) !== -1) && !cleanedUp) {
          debug('false write response, pause', state.awaitDrain);
          state.awaitDrain++;
        }
  
        src.pause();
      }
    } // if the dest has an error, then stop piping into it.
    // however, don't suppress the throwing behavior for this.
  
  
    function onerror(er) {
      debug('onerror', er);
      unpipe();
      dest.removeListener('error', onerror);
      if (EElistenerCount(dest, 'error') === 0) errorOrDestroy(dest, er);
    } // Make sure our error handler is attached before userland ones.
  
  
    prependListener(dest, 'error', onerror); // Both close and finish should trigger unpipe, but only once.
  
    function onclose() {
      dest.removeListener('finish', onfinish);
      unpipe();
    }
  
    dest.once('close', onclose);
  
    function onfinish() {
      debug('onfinish');
      dest.removeListener('close', onclose);
      unpipe();
    }
  
    dest.once('finish', onfinish);
  
    function unpipe() {
      debug('unpipe');
      src.unpipe(dest);
    } // tell the dest that it's being piped to
  
  
    dest.emit('pipe', src); // start the flow if it hasn't been started already.
  
    if (!state.flowing) {
      debug('pipe resume');
      src.resume();
    }
  
    return dest;
  };
  
  function pipeOnDrain(src) {
    return function pipeOnDrainFunctionResult() {
      var state = src._readableState;
      debug('pipeOnDrain', state.awaitDrain);
      if (state.awaitDrain) state.awaitDrain--;
  
      if (state.awaitDrain === 0 && EElistenerCount(src, 'data')) {
        state.flowing = true;
        flow(src);
      }
    };
  }
  
  Readable.prototype.unpipe = function (dest) {
    var state = this._readableState;
    var unpipeInfo = {
      hasUnpiped: false
    }; // if we're not piping anywhere, then do nothing.
  
    if (state.pipesCount === 0) return this; // just one destination.  most common case.
  
    if (state.pipesCount === 1) {
      // passed in one, but it's not the right one.
      if (dest && dest !== state.pipes) return this;
      if (!dest) dest = state.pipes; // got a match.
  
      state.pipes = null;
      state.pipesCount = 0;
      state.flowing = false;
      if (dest) dest.emit('unpipe', this, unpipeInfo);
      return this;
    } // slow case. multiple pipe destinations.
  
  
    if (!dest) {
      // remove all.
      var dests = state.pipes;
      var len = state.pipesCount;
      state.pipes = null;
      state.pipesCount = 0;
      state.flowing = false;
  
      for (var i = 0; i < len; i++) {
        dests[i].emit('unpipe', this, {
          hasUnpiped: false
        });
      }
  
      return this;
    } // try to find the right one.
  
  
    var index = indexOf(state.pipes, dest);
    if (index === -1) return this;
    state.pipes.splice(index, 1);
    state.pipesCount -= 1;
    if (state.pipesCount === 1) state.pipes = state.pipes[0];
    dest.emit('unpipe', this, unpipeInfo);
    return this;
  }; // set up data events if they are asked for
  // Ensure readable listeners eventually get something
  
  
  Readable.prototype.on = function (ev, fn) {
    var res = Stream.prototype.on.call(this, ev, fn);
    var state = this._readableState;
  
    if (ev === 'data') {
      // update readableListening so that resume() may be a no-op
      // a few lines down. This is needed to support once('readable').
      state.readableListening = this.listenerCount('readable') > 0; // Try start flowing on next tick if stream isn't explicitly paused
  
      if (state.flowing !== false) this.resume();
    } else if (ev === 'readable') {
      if (!state.endEmitted && !state.readableListening) {
        state.readableListening = state.needReadable = true;
        state.flowing = false;
        state.emittedReadable = false;
        debug('on readable', state.length, state.reading);
  
        if (state.length) {
          emitReadable(this);
        } else if (!state.reading) {
          process.nextTick(nReadingNextTick, this);
        }
      }
    }
  
    return res;
  };
  
  Readable.prototype.addListener = Readable.prototype.on;
  
  Readable.prototype.removeListener = function (ev, fn) {
    var res = Stream.prototype.removeListener.call(this, ev, fn);
  
    if (ev === 'readable') {
      // We need to check if there is someone still listening to
      // readable and reset the state. However this needs to happen
      // after readable has been emitted but before I/O (nextTick) to
      // support once('readable', fn) cycles. This means that calling
      // resume within the same tick will have no
      // effect.
      process.nextTick(updateReadableListening, this);
    }
  
    return res;
  };
  
  Readable.prototype.removeAllListeners = function (ev) {
    var res = Stream.prototype.removeAllListeners.apply(this, arguments);
  
    if (ev === 'readable' || ev === undefined) {
      // We need to check if there is someone still listening to
      // readable and reset the state. However this needs to happen
      // after readable has been emitted but before I/O (nextTick) to
      // support once('readable', fn) cycles. This means that calling
      // resume within the same tick will have no
      // effect.
      process.nextTick(updateReadableListening, this);
    }
  
    return res;
  };
  
  function updateReadableListening(self) {
    var state = self._readableState;
    state.readableListening = self.listenerCount('readable') > 0;
  
    if (state.resumeScheduled && !state.paused) {
      // flowing needs to be set to true now, otherwise
      // the upcoming resume will not flow.
      state.flowing = true; // crude way to check if we should resume
    } else if (self.listenerCount('data') > 0) {
      self.resume();
    }
  }
  
  function nReadingNextTick(self) {
    debug('readable nexttick read 0');
    self.read(0);
  } // pause() and resume() are remnants of the legacy readable stream API
  // If the user uses them, then switch into old mode.
  
  
  Readable.prototype.resume = function () {
    var state = this._readableState;
  
    if (!state.flowing) {
      debug('resume'); // we flow only if there is no one listening
      // for readable, but we still have to call
      // resume()
  
      state.flowing = !state.readableListening;
      resume(this, state);
    }
  
    state.paused = false;
    return this;
  };
  
  function resume(stream, state) {
    if (!state.resumeScheduled) {
      state.resumeScheduled = true;
      process.nextTick(resume_, stream, state);
    }
  }
  
  function resume_(stream, state) {
    debug('resume', state.reading);
  
    if (!state.reading) {
      stream.read(0);
    }
  
    state.resumeScheduled = false;
    stream.emit('resume');
    flow(stream);
    if (state.flowing && !state.reading) stream.read(0);
  }
  
  Readable.prototype.pause = function () {
    debug('call pause flowing=%j', this._readableState.flowing);
  
    if (this._readableState.flowing !== false) {
      debug('pause');
      this._readableState.flowing = false;
      this.emit('pause');
    }
  
    this._readableState.paused = true;
    return this;
  };
  
  function flow(stream) {
    var state = stream._readableState;
    debug('flow', state.flowing);
  
    while (state.flowing && stream.read() !== null) {
      ;
    }
  } // wrap an old-style stream as the async data source.
  // This is *not* part of the readable stream interface.
  // It is an ugly unfortunate mess of history.
  
  
  Readable.prototype.wrap = function (stream) {
    var _this = this;
  
    var state = this._readableState;
    var paused = false;
    stream.on('end', function () {
      debug('wrapped end');
  
      if (state.decoder && !state.ended) {
        var chunk = state.decoder.end();
        if (chunk && chunk.length) _this.push(chunk);
      }
  
      _this.push(null);
    });
    stream.on('data', function (chunk) {
      debug('wrapped data');
      if (state.decoder) chunk = state.decoder.write(chunk); // don't skip over falsy values in objectMode
  
      if (state.objectMode && (chunk === null || chunk === undefined)) return;else if (!state.objectMode && (!chunk || !chunk.length)) return;
  
      var ret = _this.push(chunk);
  
      if (!ret) {
        paused = true;
        stream.pause();
      }
    }); // proxy all the other methods.
    // important when wrapping filters and duplexes.
  
    for (var i in stream) {
      if (this[i] === undefined && typeof stream[i] === 'function') {
        this[i] = function methodWrap(method) {
          return function methodWrapReturnFunction() {
            return stream[method].apply(stream, arguments);
          };
        }(i);
      }
    } // proxy certain important events.
  
  
    for (var n = 0; n < kProxyEvents.length; n++) {
      stream.on(kProxyEvents[n], this.emit.bind(this, kProxyEvents[n]));
    } // when we try to consume some more bytes, simply unpause the
    // underlying stream.
  
  
    this._read = function (n) {
      debug('wrapped _read', n);
  
      if (paused) {
        paused = false;
        stream.resume();
      }
    };
  
    return this;
  };
  
  if (typeof Symbol === 'function') {
    Readable.prototype[Symbol.asyncIterator] = function () {
      if (createReadableStreamAsyncIterator === undefined) {
        createReadableStreamAsyncIterator = require('./internal/streams/async_iterator');
      }
  
      return createReadableStreamAsyncIterator(this);
    };
  }
  
  Object.defineProperty(Readable.prototype, 'readableHighWaterMark', {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      return this._readableState.highWaterMark;
    }
  });
  Object.defineProperty(Readable.prototype, 'readableBuffer', {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      return this._readableState && this._readableState.buffer;
    }
  });
  Object.defineProperty(Readable.prototype, 'readableFlowing', {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      return this._readableState.flowing;
    },
    set: function set(state) {
      if (this._readableState) {
        this._readableState.flowing = state;
      }
    }
  }); // exposed for testing purposes only.
  
  Readable._fromList = fromList;
  Object.defineProperty(Readable.prototype, 'readableLength', {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      return this._readableState.length;
    }
  }); // Pluck off n bytes from an array of buffers.
  // Length is the combined lengths of all the buffers in the list.
  // This function is designed to be inlinable, so please take care when making
  // changes to the function body.
  
  function fromList(n, state) {
    // nothing buffered
    if (state.length === 0) return null;
    var ret;
    if (state.objectMode) ret = state.buffer.shift();else if (!n || n >= state.length) {
      // read it all, truncate the list
      if (state.decoder) ret = state.buffer.join('');else if (state.buffer.length === 1) ret = state.buffer.first();else ret = state.buffer.concat(state.length);
      state.buffer.clear();
    } else {
      // read part of list
      ret = state.buffer.consume(n, state.decoder);
    }
    return ret;
  }
  
  function endReadable(stream) {
    var state = stream._readableState;
    debug('endReadable', state.endEmitted);
  
    if (!state.endEmitted) {
      state.ended = true;
      process.nextTick(endReadableNT, state, stream);
    }
  }
  
  function endReadableNT(state, stream) {
    debug('endReadableNT', state.endEmitted, state.length); // Check that we didn't get one last unshift.
  
    if (!state.endEmitted && state.length === 0) {
      state.endEmitted = true;
      stream.readable = false;
      stream.emit('end');
  
      if (state.autoDestroy) {
        // In case of duplex streams we need a way to detect
        // if the writable side is ready for autoDestroy as well
        var wState = stream._writableState;
  
        if (!wState || wState.autoDestroy && wState.finished) {
          stream.destroy();
        }
      }
    }
  }
  
  if (typeof Symbol === 'function') {
    Readable.from = function (iterable, opts) {
      if (from === undefined) {
        from = require('./internal/streams/from');
      }
  
      return from(Readable, iterable, opts);
    };
  }
  
  function indexOf(xs, x) {
    for (var i = 0, l = xs.length; i < l; i++) {
      if (xs[i] === x) return i;
    }
  
    return -1;
  }
  }).call(this)}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
  },{"../errors":21,"./_stream_duplex":22,"./internal/streams/async_iterator":27,"./internal/streams/buffer_list":28,"./internal/streams/destroy":29,"./internal/streams/from":31,"./internal/streams/state":33,"./internal/streams/stream":34,"_process":11,"buffer":3,"events":5,"inherits":8,"string_decoder/":36,"util":2}],25:[function(require,module,exports){
  // Copyright Joyent, Inc. and other Node contributors.
  //
  // Permission is hereby granted, free of charge, to any person obtaining a
  // copy of this software and associated documentation files (the
  // "Software"), to deal in the Software without restriction, including
  // without limitation the rights to use, copy, modify, merge, publish,
  // distribute, sublicense, and/or sell copies of the Software, and to permit
  // persons to whom the Software is furnished to do so, subject to the
  // following conditions:
  //
  // The above copyright notice and this permission notice shall be included
  // in all copies or substantial portions of the Software.
  //
  // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
  // OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  // MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
  // NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
  // DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  // OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
  // USE OR OTHER DEALINGS IN THE SOFTWARE.
  // a transform stream is a readable/writable stream where you do
  // something with the data.  Sometimes it's called a "filter",
  // but that's not a great name for it, since that implies a thing where
  // some bits pass through, and others are simply ignored.  (That would
  // be a valid example of a transform, of course.)
  //
  // While the output is causally related to the input, it's not a
  // necessarily symmetric or synchronous transformation.  For example,
  // a zlib stream might take multiple plain-text writes(), and then
  // emit a single compressed chunk some time in the future.
  //
  // Here's how this works:
  //
  // The Transform stream has all the aspects of the readable and writable
  // stream classes.  When you write(chunk), that calls _write(chunk,cb)
  // internally, and returns false if there's a lot of pending writes
  // buffered up.  When you call read(), that calls _read(n) until
  // there's enough pending readable data buffered up.
  //
  // In a transform stream, the written data is placed in a buffer.  When
  // _read(n) is called, it transforms the queued up data, calling the
  // buffered _write cb's as it consumes chunks.  If consuming a single
  // written chunk would result in multiple output chunks, then the first
  // outputted bit calls the readcb, and subsequent chunks just go into
  // the read buffer, and will cause it to emit 'readable' if necessary.
  //
  // This way, back-pressure is actually determined by the reading side,
  // since _read has to be called to start processing a new chunk.  However,
  // a pathological inflate type of transform can cause excessive buffering
  // here.  For example, imagine a stream where every byte of input is
  // interpreted as an integer from 0-255, and then results in that many
  // bytes of output.  Writing the 4 bytes {ff,ff,ff,ff} would result in
  // 1kb of data being output.  In this case, you could write a very small
  // amount of input, and end up with a very large amount of output.  In
  // such a pathological inflating mechanism, there'd be no way to tell
  // the system to stop doing the transform.  A single 4MB write could
  // cause the system to run out of memory.
  //
  // However, even in such a pathological case, only a single written chunk
  // would be consumed, and then the rest would wait (un-transformed) until
  // the results of the previous transformed chunk were consumed.
  'use strict';
  
  module.exports = Transform;
  
  var _require$codes = require('../errors').codes,
      ERR_METHOD_NOT_IMPLEMENTED = _require$codes.ERR_METHOD_NOT_IMPLEMENTED,
      ERR_MULTIPLE_CALLBACK = _require$codes.ERR_MULTIPLE_CALLBACK,
      ERR_TRANSFORM_ALREADY_TRANSFORMING = _require$codes.ERR_TRANSFORM_ALREADY_TRANSFORMING,
      ERR_TRANSFORM_WITH_LENGTH_0 = _require$codes.ERR_TRANSFORM_WITH_LENGTH_0;
  
  var Duplex = require('./_stream_duplex');
  
  require('inherits')(Transform, Duplex);
  
  function afterTransform(er, data) {
    var ts = this._transformState;
    ts.transforming = false;
    var cb = ts.writecb;
  
    if (cb === null) {
      return this.emit('error', new ERR_MULTIPLE_CALLBACK());
    }
  
    ts.writechunk = null;
    ts.writecb = null;
    if (data != null) // single equals check for both `null` and `undefined`
      this.push(data);
    cb(er);
    var rs = this._readableState;
    rs.reading = false;
  
    if (rs.needReadable || rs.length < rs.highWaterMark) {
      this._read(rs.highWaterMark);
    }
  }
  
  function Transform(options) {
    if (!(this instanceof Transform)) return new Transform(options);
    Duplex.call(this, options);
    this._transformState = {
      afterTransform: afterTransform.bind(this),
      needTransform: false,
      transforming: false,
      writecb: null,
      writechunk: null,
      writeencoding: null
    }; // start out asking for a readable event once data is transformed.
  
    this._readableState.needReadable = true; // we have implemented the _read method, and done the other things
    // that Readable wants before the first _read call, so unset the
    // sync guard flag.
  
    this._readableState.sync = false;
  
    if (options) {
      if (typeof options.transform === 'function') this._transform = options.transform;
      if (typeof options.flush === 'function') this._flush = options.flush;
    } // When the writable side finishes, then flush out anything remaining.
  
  
    this.on('prefinish', prefinish);
  }
  
  function prefinish() {
    var _this = this;
  
    if (typeof this._flush === 'function' && !this._readableState.destroyed) {
      this._flush(function (er, data) {
        done(_this, er, data);
      });
    } else {
      done(this, null, null);
    }
  }
  
  Transform.prototype.push = function (chunk, encoding) {
    this._transformState.needTransform = false;
    return Duplex.prototype.push.call(this, chunk, encoding);
  }; // This is the part where you do stuff!
  // override this function in implementation classes.
  // 'chunk' is an input chunk.
  //
  // Call `push(newChunk)` to pass along transformed output
  // to the readable side.  You may call 'push' zero or more times.
  //
  // Call `cb(err)` when you are done with this chunk.  If you pass
  // an error, then that'll put the hurt on the whole operation.  If you
  // never call cb(), then you'll never get another chunk.
  
  
  Transform.prototype._transform = function (chunk, encoding, cb) {
    cb(new ERR_METHOD_NOT_IMPLEMENTED('_transform()'));
  };
  
  Transform.prototype._write = function (chunk, encoding, cb) {
    var ts = this._transformState;
    ts.writecb = cb;
    ts.writechunk = chunk;
    ts.writeencoding = encoding;
  
    if (!ts.transforming) {
      var rs = this._readableState;
      if (ts.needTransform || rs.needReadable || rs.length < rs.highWaterMark) this._read(rs.highWaterMark);
    }
  }; // Doesn't matter what the args are here.
  // _transform does all the work.
  // That we got here means that the readable side wants more data.
  
  
  Transform.prototype._read = function (n) {
    var ts = this._transformState;
  
    if (ts.writechunk !== null && !ts.transforming) {
      ts.transforming = true;
  
      this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
    } else {
      // mark that we need a transform, so that any data that comes in
      // will get processed, now that we've asked for it.
      ts.needTransform = true;
    }
  };
  
  Transform.prototype._destroy = function (err, cb) {
    Duplex.prototype._destroy.call(this, err, function (err2) {
      cb(err2);
    });
  };
  
  function done(stream, er, data) {
    if (er) return stream.emit('error', er);
    if (data != null) // single equals check for both `null` and `undefined`
      stream.push(data); // TODO(BridgeAR): Write a test for these two error cases
    // if there's nothing in the write buffer, then that means
    // that nothing more will ever be provided
  
    if (stream._writableState.length) throw new ERR_TRANSFORM_WITH_LENGTH_0();
    if (stream._transformState.transforming) throw new ERR_TRANSFORM_ALREADY_TRANSFORMING();
    return stream.push(null);
  }
  },{"../errors":21,"./_stream_duplex":22,"inherits":8}],26:[function(require,module,exports){
  (function (process,global){(function (){
  // Copyright Joyent, Inc. and other Node contributors.
  //
  // Permission is hereby granted, free of charge, to any person obtaining a
  // copy of this software and associated documentation files (the
  // "Software"), to deal in the Software without restriction, including
  // without limitation the rights to use, copy, modify, merge, publish,
  // distribute, sublicense, and/or sell copies of the Software, and to permit
  // persons to whom the Software is furnished to do so, subject to the
  // following conditions:
  //
  // The above copyright notice and this permission notice shall be included
  // in all copies or substantial portions of the Software.
  //
  // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
  // OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  // MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
  // NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
  // DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  // OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
  // USE OR OTHER DEALINGS IN THE SOFTWARE.
  // A bit simpler than readable streams.
  // Implement an async ._write(chunk, encoding, cb), and it'll handle all
  // the drain event emission and buffering.
  'use strict';
  
  module.exports = Writable;
  /* <replacement> */
  
  function WriteReq(chunk, encoding, cb) {
    this.chunk = chunk;
    this.encoding = encoding;
    this.callback = cb;
    this.next = null;
  } // It seems a linked list but it is not
  // there will be only 2 of these for each stream
  
  
  function CorkedRequest(state) {
    var _this = this;
  
    this.next = null;
    this.entry = null;
  
    this.finish = function () {
      onCorkedFinish(_this, state);
    };
  }
  /* </replacement> */
  
  /*<replacement>*/
  
  
  var Duplex;
  /*</replacement>*/
  
  Writable.WritableState = WritableState;
  /*<replacement>*/
  
  var internalUtil = {
    deprecate: require('util-deprecate')
  };
  /*</replacement>*/
  
  /*<replacement>*/
  
  var Stream = require('./internal/streams/stream');
  /*</replacement>*/
  
  
  var Buffer = require('buffer').Buffer;
  
  var OurUint8Array = global.Uint8Array || function () {};
  
  function _uint8ArrayToBuffer(chunk) {
    return Buffer.from(chunk);
  }
  
  function _isUint8Array(obj) {
    return Buffer.isBuffer(obj) || obj instanceof OurUint8Array;
  }
  
  var destroyImpl = require('./internal/streams/destroy');
  
  var _require = require('./internal/streams/state'),
      getHighWaterMark = _require.getHighWaterMark;
  
  var _require$codes = require('../errors').codes,
      ERR_INVALID_ARG_TYPE = _require$codes.ERR_INVALID_ARG_TYPE,
      ERR_METHOD_NOT_IMPLEMENTED = _require$codes.ERR_METHOD_NOT_IMPLEMENTED,
      ERR_MULTIPLE_CALLBACK = _require$codes.ERR_MULTIPLE_CALLBACK,
      ERR_STREAM_CANNOT_PIPE = _require$codes.ERR_STREAM_CANNOT_PIPE,
      ERR_STREAM_DESTROYED = _require$codes.ERR_STREAM_DESTROYED,
      ERR_STREAM_NULL_VALUES = _require$codes.ERR_STREAM_NULL_VALUES,
      ERR_STREAM_WRITE_AFTER_END = _require$codes.ERR_STREAM_WRITE_AFTER_END,
      ERR_UNKNOWN_ENCODING = _require$codes.ERR_UNKNOWN_ENCODING;
  
  var errorOrDestroy = destroyImpl.errorOrDestroy;
  
  require('inherits')(Writable, Stream);
  
  function nop() {}
  
  function WritableState(options, stream, isDuplex) {
    Duplex = Duplex || require('./_stream_duplex');
    options = options || {}; // Duplex streams are both readable and writable, but share
    // the same options object.
    // However, some cases require setting options to different
    // values for the readable and the writable sides of the duplex stream,
    // e.g. options.readableObjectMode vs. options.writableObjectMode, etc.
  
    if (typeof isDuplex !== 'boolean') isDuplex = stream instanceof Duplex; // object stream flag to indicate whether or not this stream
    // contains buffers or objects.
  
    this.objectMode = !!options.objectMode;
    if (isDuplex) this.objectMode = this.objectMode || !!options.writableObjectMode; // the point at which write() starts returning false
    // Note: 0 is a valid value, means that we always return false if
    // the entire buffer is not flushed immediately on write()
  
    this.highWaterMark = getHighWaterMark(this, options, 'writableHighWaterMark', isDuplex); // if _final has been called
  
    this.finalCalled = false; // drain event flag.
  
    this.needDrain = false; // at the start of calling end()
  
    this.ending = false; // when end() has been called, and returned
  
    this.ended = false; // when 'finish' is emitted
  
    this.finished = false; // has it been destroyed
  
    this.destroyed = false; // should we decode strings into buffers before passing to _write?
    // this is here so that some node-core streams can optimize string
    // handling at a lower level.
  
    var noDecode = options.decodeStrings === false;
    this.decodeStrings = !noDecode; // Crypto is kind of old and crusty.  Historically, its default string
    // encoding is 'binary' so we have to make this configurable.
    // Everything else in the universe uses 'utf8', though.
  
    this.defaultEncoding = options.defaultEncoding || 'utf8'; // not an actual buffer we keep track of, but a measurement
    // of how much we're waiting to get pushed to some underlying
    // socket or file.
  
    this.length = 0; // a flag to see when we're in the middle of a write.
  
    this.writing = false; // when true all writes will be buffered until .uncork() call
  
    this.corked = 0; // a flag to be able to tell if the onwrite cb is called immediately,
    // or on a later tick.  We set this to true at first, because any
    // actions that shouldn't happen until "later" should generally also
    // not happen before the first write call.
  
    this.sync = true; // a flag to know if we're processing previously buffered items, which
    // may call the _write() callback in the same tick, so that we don't
    // end up in an overlapped onwrite situation.
  
    this.bufferProcessing = false; // the callback that's passed to _write(chunk,cb)
  
    this.onwrite = function (er) {
      onwrite(stream, er);
    }; // the callback that the user supplies to write(chunk,encoding,cb)
  
  
    this.writecb = null; // the amount that is being written when _write is called.
  
    this.writelen = 0;
    this.bufferedRequest = null;
    this.lastBufferedRequest = null; // number of pending user-supplied write callbacks
    // this must be 0 before 'finish' can be emitted
  
    this.pendingcb = 0; // emit prefinish if the only thing we're waiting for is _write cbs
    // This is relevant for synchronous Transform streams
  
    this.prefinished = false; // True if the error was already emitted and should not be thrown again
  
    this.errorEmitted = false; // Should close be emitted on destroy. Defaults to true.
  
    this.emitClose = options.emitClose !== false; // Should .destroy() be called after 'finish' (and potentially 'end')
  
    this.autoDestroy = !!options.autoDestroy; // count buffered requests
  
    this.bufferedRequestCount = 0; // allocate the first CorkedRequest, there is always
    // one allocated and free to use, and we maintain at most two
  
    this.corkedRequestsFree = new CorkedRequest(this);
  }
  
  WritableState.prototype.getBuffer = function getBuffer() {
    var current = this.bufferedRequest;
    var out = [];
  
    while (current) {
      out.push(current);
      current = current.next;
    }
  
    return out;
  };
  
  (function () {
    try {
      Object.defineProperty(WritableState.prototype, 'buffer', {
        get: internalUtil.deprecate(function writableStateBufferGetter() {
          return this.getBuffer();
        }, '_writableState.buffer is deprecated. Use _writableState.getBuffer ' + 'instead.', 'DEP0003')
      });
    } catch (_) {}
  })(); // Test _writableState for inheritance to account for Duplex streams,
  // whose prototype chain only points to Readable.
  
  
  var realHasInstance;
  
  if (typeof Symbol === 'function' && Symbol.hasInstance && typeof Function.prototype[Symbol.hasInstance] === 'function') {
    realHasInstance = Function.prototype[Symbol.hasInstance];
    Object.defineProperty(Writable, Symbol.hasInstance, {
      value: function value(object) {
        if (realHasInstance.call(this, object)) return true;
        if (this !== Writable) return false;
        return object && object._writableState instanceof WritableState;
      }
    });
  } else {
    realHasInstance = function realHasInstance(object) {
      return object instanceof this;
    };
  }
  
  function Writable(options) {
    Duplex = Duplex || require('./_stream_duplex'); // Writable ctor is applied to Duplexes, too.
    // `realHasInstance` is necessary because using plain `instanceof`
    // would return false, as no `_writableState` property is attached.
    // Trying to use the custom `instanceof` for Writable here will also break the
    // Node.js LazyTransform implementation, which has a non-trivial getter for
    // `_writableState` that would lead to infinite recursion.
    // Checking for a Stream.Duplex instance is faster here instead of inside
    // the WritableState constructor, at least with V8 6.5
  
    var isDuplex = this instanceof Duplex;
    if (!isDuplex && !realHasInstance.call(Writable, this)) return new Writable(options);
    this._writableState = new WritableState(options, this, isDuplex); // legacy.
  
    this.writable = true;
  
    if (options) {
      if (typeof options.write === 'function') this._write = options.write;
      if (typeof options.writev === 'function') this._writev = options.writev;
      if (typeof options.destroy === 'function') this._destroy = options.destroy;
      if (typeof options.final === 'function') this._final = options.final;
    }
  
    Stream.call(this);
  } // Otherwise people can pipe Writable streams, which is just wrong.
  
  
  Writable.prototype.pipe = function () {
    errorOrDestroy(this, new ERR_STREAM_CANNOT_PIPE());
  };
  
  function writeAfterEnd(stream, cb) {
    var er = new ERR_STREAM_WRITE_AFTER_END(); // TODO: defer error events consistently everywhere, not just the cb
  
    errorOrDestroy(stream, er);
    process.nextTick(cb, er);
  } // Checks that a user-supplied chunk is valid, especially for the particular
  // mode the stream is in. Currently this means that `null` is never accepted
  // and undefined/non-string values are only allowed in object mode.
  
  
  function validChunk(stream, state, chunk, cb) {
    var er;
  
    if (chunk === null) {
      er = new ERR_STREAM_NULL_VALUES();
    } else if (typeof chunk !== 'string' && !state.objectMode) {
      er = new ERR_INVALID_ARG_TYPE('chunk', ['string', 'Buffer'], chunk);
    }
  
    if (er) {
      errorOrDestroy(stream, er);
      process.nextTick(cb, er);
      return false;
    }
  
    return true;
  }
  
  Writable.prototype.write = function (chunk, encoding, cb) {
    var state = this._writableState;
    var ret = false;
  
    var isBuf = !state.objectMode && _isUint8Array(chunk);
  
    if (isBuf && !Buffer.isBuffer(chunk)) {
      chunk = _uint8ArrayToBuffer(chunk);
    }
  
    if (typeof encoding === 'function') {
      cb = encoding;
      encoding = null;
    }
  
    if (isBuf) encoding = 'buffer';else if (!encoding) encoding = state.defaultEncoding;
    if (typeof cb !== 'function') cb = nop;
    if (state.ending) writeAfterEnd(this, cb);else if (isBuf || validChunk(this, state, chunk, cb)) {
      state.pendingcb++;
      ret = writeOrBuffer(this, state, isBuf, chunk, encoding, cb);
    }
    return ret;
  };
  
  Writable.prototype.cork = function () {
    this._writableState.corked++;
  };
  
  Writable.prototype.uncork = function () {
    var state = this._writableState;
  
    if (state.corked) {
      state.corked--;
      if (!state.writing && !state.corked && !state.bufferProcessing && state.bufferedRequest) clearBuffer(this, state);
    }
  };
  
  Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
    // node::ParseEncoding() requires lower case.
    if (typeof encoding === 'string') encoding = encoding.toLowerCase();
    if (!(['hex', 'utf8', 'utf-8', 'ascii', 'binary', 'base64', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le', 'raw'].indexOf((encoding + '').toLowerCase()) > -1)) throw new ERR_UNKNOWN_ENCODING(encoding);
    this._writableState.defaultEncoding = encoding;
    return this;
  };
  
  Object.defineProperty(Writable.prototype, 'writableBuffer', {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      return this._writableState && this._writableState.getBuffer();
    }
  });
  
  function decodeChunk(state, chunk, encoding) {
    if (!state.objectMode && state.decodeStrings !== false && typeof chunk === 'string') {
      chunk = Buffer.from(chunk, encoding);
    }
  
    return chunk;
  }
  
  Object.defineProperty(Writable.prototype, 'writableHighWaterMark', {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      return this._writableState.highWaterMark;
    }
  }); // if we're already writing something, then just put this
  // in the queue, and wait our turn.  Otherwise, call _write
  // If we return false, then we need a drain event, so set that flag.
  
  function writeOrBuffer(stream, state, isBuf, chunk, encoding, cb) {
    if (!isBuf) {
      var newChunk = decodeChunk(state, chunk, encoding);
  
      if (chunk !== newChunk) {
        isBuf = true;
        encoding = 'buffer';
        chunk = newChunk;
      }
    }
  
    var len = state.objectMode ? 1 : chunk.length;
    state.length += len;
    var ret = state.length < state.highWaterMark; // we must ensure that previous needDrain will not be reset to false.
  
    if (!ret) state.needDrain = true;
  
    if (state.writing || state.corked) {
      var last = state.lastBufferedRequest;
      state.lastBufferedRequest = {
        chunk: chunk,
        encoding: encoding,
        isBuf: isBuf,
        callback: cb,
        next: null
      };
  
      if (last) {
        last.next = state.lastBufferedRequest;
      } else {
        state.bufferedRequest = state.lastBufferedRequest;
      }
  
      state.bufferedRequestCount += 1;
    } else {
      doWrite(stream, state, false, len, chunk, encoding, cb);
    }
  
    return ret;
  }
  
  function doWrite(stream, state, writev, len, chunk, encoding, cb) {
    state.writelen = len;
    state.writecb = cb;
    state.writing = true;
    state.sync = true;
    if (state.destroyed) state.onwrite(new ERR_STREAM_DESTROYED('write'));else if (writev) stream._writev(chunk, state.onwrite);else stream._write(chunk, encoding, state.onwrite);
    state.sync = false;
  }
  
  function onwriteError(stream, state, sync, er, cb) {
    --state.pendingcb;
  
    if (sync) {
      // defer the callback if we are being called synchronously
      // to avoid piling up things on the stack
      process.nextTick(cb, er); // this can emit finish, and it will always happen
      // after error
  
      process.nextTick(finishMaybe, stream, state);
      stream._writableState.errorEmitted = true;
      errorOrDestroy(stream, er);
    } else {
      // the caller expect this to happen before if
      // it is async
      cb(er);
      stream._writableState.errorEmitted = true;
      errorOrDestroy(stream, er); // this can emit finish, but finish must
      // always follow error
  
      finishMaybe(stream, state);
    }
  }
  
  function onwriteStateUpdate(state) {
    state.writing = false;
    state.writecb = null;
    state.length -= state.writelen;
    state.writelen = 0;
  }
  
  function onwrite(stream, er) {
    var state = stream._writableState;
    var sync = state.sync;
    var cb = state.writecb;
    if (typeof cb !== 'function') throw new ERR_MULTIPLE_CALLBACK();
    onwriteStateUpdate(state);
    if (er) onwriteError(stream, state, sync, er, cb);else {
      // Check if we're actually ready to finish, but don't emit yet
      var finished = needFinish(state) || stream.destroyed;
  
      if (!finished && !state.corked && !state.bufferProcessing && state.bufferedRequest) {
        clearBuffer(stream, state);
      }
  
      if (sync) {
        process.nextTick(afterWrite, stream, state, finished, cb);
      } else {
        afterWrite(stream, state, finished, cb);
      }
    }
  }
  
  function afterWrite(stream, state, finished, cb) {
    if (!finished) onwriteDrain(stream, state);
    state.pendingcb--;
    cb();
    finishMaybe(stream, state);
  } // Must force callback to be called on nextTick, so that we don't
  // emit 'drain' before the write() consumer gets the 'false' return
  // value, and has a chance to attach a 'drain' listener.
  
  
  function onwriteDrain(stream, state) {
    if (state.length === 0 && state.needDrain) {
      state.needDrain = false;
      stream.emit('drain');
    }
  } // if there's something in the buffer waiting, then process it
  
  
  function clearBuffer(stream, state) {
    state.bufferProcessing = true;
    var entry = state.bufferedRequest;
  
    if (stream._writev && entry && entry.next) {
      // Fast case, write everything using _writev()
      var l = state.bufferedRequestCount;
      var buffer = new Array(l);
      var holder = state.corkedRequestsFree;
      holder.entry = entry;
      var count = 0;
      var allBuffers = true;
  
      while (entry) {
        buffer[count] = entry;
        if (!entry.isBuf) allBuffers = false;
        entry = entry.next;
        count += 1;
      }
  
      buffer.allBuffers = allBuffers;
      doWrite(stream, state, true, state.length, buffer, '', holder.finish); // doWrite is almost always async, defer these to save a bit of time
      // as the hot path ends with doWrite
  
      state.pendingcb++;
      state.lastBufferedRequest = null;
  
      if (holder.next) {
        state.corkedRequestsFree = holder.next;
        holder.next = null;
      } else {
        state.corkedRequestsFree = new CorkedRequest(state);
      }
  
      state.bufferedRequestCount = 0;
    } else {
      // Slow case, write chunks one-by-one
      while (entry) {
        var chunk = entry.chunk;
        var encoding = entry.encoding;
        var cb = entry.callback;
        var len = state.objectMode ? 1 : chunk.length;
        doWrite(stream, state, false, len, chunk, encoding, cb);
        entry = entry.next;
        state.bufferedRequestCount--; // if we didn't call the onwrite immediately, then
        // it means that we need to wait until it does.
        // also, that means that the chunk and cb are currently
        // being processed, so move the buffer counter past them.
  
        if (state.writing) {
          break;
        }
      }
  
      if (entry === null) state.lastBufferedRequest = null;
    }
  
    state.bufferedRequest = entry;
    state.bufferProcessing = false;
  }
  
  Writable.prototype._write = function (chunk, encoding, cb) {
    cb(new ERR_METHOD_NOT_IMPLEMENTED('_write()'));
  };
  
  Writable.prototype._writev = null;
  
  Writable.prototype.end = function (chunk, encoding, cb) {
    var state = this._writableState;
  
    if (typeof chunk === 'function') {
      cb = chunk;
      chunk = null;
      encoding = null;
    } else if (typeof encoding === 'function') {
      cb = encoding;
      encoding = null;
    }
  
    if (chunk !== null && chunk !== undefined) this.write(chunk, encoding); // .end() fully uncorks
  
    if (state.corked) {
      state.corked = 1;
      this.uncork();
    } // ignore unnecessary end() calls.
  
  
    if (!state.ending) endWritable(this, state, cb);
    return this;
  };
  
  Object.defineProperty(Writable.prototype, 'writableLength', {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      return this._writableState.length;
    }
  });
  
  function needFinish(state) {
    return state.ending && state.length === 0 && state.bufferedRequest === null && !state.finished && !state.writing;
  }
  
  function callFinal(stream, state) {
    stream._final(function (err) {
      state.pendingcb--;
  
      if (err) {
        errorOrDestroy(stream, err);
      }
  
      state.prefinished = true;
      stream.emit('prefinish');
      finishMaybe(stream, state);
    });
  }
  
  function prefinish(stream, state) {
    if (!state.prefinished && !state.finalCalled) {
      if (typeof stream._final === 'function' && !state.destroyed) {
        state.pendingcb++;
        state.finalCalled = true;
        process.nextTick(callFinal, stream, state);
      } else {
        state.prefinished = true;
        stream.emit('prefinish');
      }
    }
  }
  
  function finishMaybe(stream, state) {
    var need = needFinish(state);
  
    if (need) {
      prefinish(stream, state);
  
      if (state.pendingcb === 0) {
        state.finished = true;
        stream.emit('finish');
  
        if (state.autoDestroy) {
          // In case of duplex streams we need a way to detect
          // if the readable side is ready for autoDestroy as well
          var rState = stream._readableState;
  
          if (!rState || rState.autoDestroy && rState.endEmitted) {
            stream.destroy();
          }
        }
      }
    }
  
    return need;
  }
  
  function endWritable(stream, state, cb) {
    state.ending = true;
    finishMaybe(stream, state);
  
    if (cb) {
      if (state.finished) process.nextTick(cb);else stream.once('finish', cb);
    }
  
    state.ended = true;
    stream.writable = false;
  }
  
  function onCorkedFinish(corkReq, state, err) {
    var entry = corkReq.entry;
    corkReq.entry = null;
  
    while (entry) {
      var cb = entry.callback;
      state.pendingcb--;
      cb(err);
      entry = entry.next;
    } // reuse the free corkReq.
  
  
    state.corkedRequestsFree.next = corkReq;
  }
  
  Object.defineProperty(Writable.prototype, 'destroyed', {
    // making it explicit this property is not enumerable
    // because otherwise some prototype manipulation in
    // userland will fail
    enumerable: false,
    get: function get() {
      if (this._writableState === undefined) {
        return false;
      }
  
      return this._writableState.destroyed;
    },
    set: function set(value) {
      // we ignore the value if the stream
      // has not been initialized yet
      if (!this._writableState) {
        return;
      } // backward compatibility, the user is explicitly
      // managing destroyed
  
  
      this._writableState.destroyed = value;
    }
  });
  Writable.prototype.destroy = destroyImpl.destroy;
  Writable.prototype._undestroy = destroyImpl.undestroy;
  
  Writable.prototype._destroy = function (err, cb) {
    cb(err);
  };
  }).call(this)}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
  },{"../errors":21,"./_stream_duplex":22,"./internal/streams/destroy":29,"./internal/streams/state":33,"./internal/streams/stream":34,"_process":11,"buffer":3,"inherits":8,"util-deprecate":39}],27:[function(require,module,exports){
  (function (process){(function (){
  'use strict';
  
  var _Object$setPrototypeO;
  
  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
  
  var finished = require('./end-of-stream');
  
  var kLastResolve = Symbol('lastResolve');
  var kLastReject = Symbol('lastReject');
  var kError = Symbol('error');
  var kEnded = Symbol('ended');
  var kLastPromise = Symbol('lastPromise');
  var kHandlePromise = Symbol('handlePromise');
  var kStream = Symbol('stream');
  
  function createIterResult(value, done) {
    return {
      value: value,
      done: done
    };
  }
  
  function readAndResolve(iter) {
    var resolve = iter[kLastResolve];
  
    if (resolve !== null) {
      var data = iter[kStream].read(); // we defer if data is null
      // we can be expecting either 'end' or
      // 'error'
  
      if (data !== null) {
        iter[kLastPromise] = null;
        iter[kLastResolve] = null;
        iter[kLastReject] = null;
        resolve(createIterResult(data, false));
      }
    }
  }
  
  function onReadable(iter) {
    // we wait for the next tick, because it might
    // emit an error with process.nextTick
    process.nextTick(readAndResolve, iter);
  }
  
  function wrapForNext(lastPromise, iter) {
    return function (resolve, reject) {
      lastPromise.then(function () {
        if (iter[kEnded]) {
          resolve(createIterResult(undefined, true));
          return;
        }
  
        iter[kHandlePromise](resolve, reject);
      }, reject);
    };
  }
  
  var AsyncIteratorPrototype = Object.getPrototypeOf(function () {});
  var ReadableStreamAsyncIteratorPrototype = Object.setPrototypeOf((_Object$setPrototypeO = {
    get stream() {
      return this[kStream];
    },
  
    next: function next() {
      var _this = this;
  
      // if we have detected an error in the meanwhile
      // reject straight away
      var error = this[kError];
  
      if (error !== null) {
        return Promise.reject(error);
      }
  
      if (this[kEnded]) {
        return Promise.resolve(createIterResult(undefined, true));
      }
  
      if (this[kStream].destroyed) {
        // We need to defer via nextTick because if .destroy(err) is
        // called, the error will be emitted via nextTick, and
        // we cannot guarantee that there is no error lingering around
        // waiting to be emitted.
        return new Promise(function (resolve, reject) {
          process.nextTick(function () {
            if (_this[kError]) {
              reject(_this[kError]);
            } else {
              resolve(createIterResult(undefined, true));
            }
          });
        });
      } // if we have multiple next() calls
      // we will wait for the previous Promise to finish
      // this logic is optimized to support for await loops,
      // where next() is only called once at a time
  
  
      var lastPromise = this[kLastPromise];
      var promise;
  
      if (lastPromise) {
        promise = new Promise(wrapForNext(lastPromise, this));
      } else {
        // fast path needed to support multiple this.push()
        // without triggering the next() queue
        var data = this[kStream].read();
  
        if (data !== null) {
          return Promise.resolve(createIterResult(data, false));
        }
  
        promise = new Promise(this[kHandlePromise]);
      }
  
      this[kLastPromise] = promise;
      return promise;
    }
  }, _defineProperty(_Object$setPrototypeO, Symbol.asyncIterator, function () {
    return this;
  }), _defineProperty(_Object$setPrototypeO, "return", function _return() {
    var _this2 = this;
  
    // destroy(err, cb) is a private API
    // we can guarantee we have that here, because we control the
    // Readable class this is attached to
    return new Promise(function (resolve, reject) {
      _this2[kStream].destroy(null, function (err) {
        if (err) {
          reject(err);
          return;
        }
  
        resolve(createIterResult(undefined, true));
      });
    });
  }), _Object$setPrototypeO), AsyncIteratorPrototype);
  
  var createReadableStreamAsyncIterator = function createReadableStreamAsyncIterator(stream) {
    var _Object$create;
  
    var iterator = Object.create(ReadableStreamAsyncIteratorPrototype, (_Object$create = {}, _defineProperty(_Object$create, kStream, {
      value: stream,
      writable: true
    }), _defineProperty(_Object$create, kLastResolve, {
      value: null,
      writable: true
    }), _defineProperty(_Object$create, kLastReject, {
      value: null,
      writable: true
    }), _defineProperty(_Object$create, kError, {
      value: null,
      writable: true
    }), _defineProperty(_Object$create, kEnded, {
      value: stream._readableState.endEmitted,
      writable: true
    }), _defineProperty(_Object$create, kHandlePromise, {
      value: function value(resolve, reject) {
        var data = iterator[kStream].read();
  
        if (data) {
          iterator[kLastPromise] = null;
          iterator[kLastResolve] = null;
          iterator[kLastReject] = null;
          resolve(createIterResult(data, false));
        } else {
          iterator[kLastResolve] = resolve;
          iterator[kLastReject] = reject;
        }
      },
      writable: true
    }), _Object$create));
    iterator[kLastPromise] = null;
    finished(stream, function (err) {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        var reject = iterator[kLastReject]; // reject if we are waiting for data in the Promise
        // returned by next() and store the error
  
        if (reject !== null) {
          iterator[kLastPromise] = null;
          iterator[kLastResolve] = null;
          iterator[kLastReject] = null;
          reject(err);
        }
  
        iterator[kError] = err;
        return;
      }
  
      var resolve = iterator[kLastResolve];
  
      if (resolve !== null) {
        iterator[kLastPromise] = null;
        iterator[kLastResolve] = null;
        iterator[kLastReject] = null;
        resolve(createIterResult(undefined, true));
      }
  
      iterator[kEnded] = true;
    });
    stream.on('readable', onReadable.bind(null, iterator));
    return iterator;
  };
  
  module.exports = createReadableStreamAsyncIterator;
  }).call(this)}).call(this,require('_process'))
  },{"./end-of-stream":30,"_process":11}],28:[function(require,module,exports){
  'use strict';
  
  function ownKeys(object, enumerableOnly) { var keys = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); if (enumerableOnly) symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym).enumerable; }); keys.push.apply(keys, symbols); } return keys; }
  
  function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; if (i % 2) { ownKeys(Object(source), true).forEach(function (key) { _defineProperty(target, key, source[key]); }); } else if (Object.getOwnPropertyDescriptors) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); } else { ownKeys(Object(source)).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } } return target; }
  
  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
  
  function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
  
  function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }
  
  function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }
  
  var _require = require('buffer'),
      Buffer = _require.Buffer;
  
  var _require2 = require('util'),
      inspect = _require2.inspect;
  
  var custom = inspect && inspect.custom || 'inspect';
  
  function copyBuffer(src, target, offset) {
    Buffer.prototype.copy.call(src, target, offset);
  }
  
  module.exports =
  /*#__PURE__*/
  function () {
    function BufferList() {
      _classCallCheck(this, BufferList);
  
      this.head = null;
      this.tail = null;
      this.length = 0;
    }
  
    _createClass(BufferList, [{
      key: "push",
      value: function push(v) {
        var entry = {
          data: v,
          next: null
        };
        if (this.length > 0) this.tail.next = entry;else this.head = entry;
        this.tail = entry;
        ++this.length;
      }
    }, {
      key: "unshift",
      value: function unshift(v) {
        var entry = {
          data: v,
          next: this.head
        };
        if (this.length === 0) this.tail = entry;
        this.head = entry;
        ++this.length;
      }
    }, {
      key: "shift",
      value: function shift() {
        if (this.length === 0) return;
        var ret = this.head.data;
        if (this.length === 1) this.head = this.tail = null;else this.head = this.head.next;
        --this.length;
        return ret;
      }
    }, {
      key: "clear",
      value: function clear() {
        this.head = this.tail = null;
        this.length = 0;
      }
    }, {
      key: "join",
      value: function join(s) {
        if (this.length === 0) return '';
        var p = this.head;
        var ret = '' + p.data;
  
        while (p = p.next) {
          ret += s + p.data;
        }
  
        return ret;
      }
    }, {
      key: "concat",
      value: function concat(n) {
        if (this.length === 0) return Buffer.alloc(0);
        var ret = Buffer.allocUnsafe(n >>> 0);
        var p = this.head;
        var i = 0;
  
        while (p) {
          copyBuffer(p.data, ret, i);
          i += p.data.length;
          p = p.next;
        }
  
        return ret;
      } // Consumes a specified amount of bytes or characters from the buffered data.
  
    }, {
      key: "consume",
      value: function consume(n, hasStrings) {
        var ret;
  
        if (n < this.head.data.length) {
          // `slice` is the same for buffers and strings.
          ret = this.head.data.slice(0, n);
          this.head.data = this.head.data.slice(n);
        } else if (n === this.head.data.length) {
          // First chunk is a perfect match.
          ret = this.shift();
        } else {
          // Result spans more than one buffer.
          ret = hasStrings ? this._getString(n) : this._getBuffer(n);
        }
  
        return ret;
      }
    }, {
      key: "first",
      value: function first() {
        return this.head.data;
      } // Consumes a specified amount of characters from the buffered data.
  
    }, {
      key: "_getString",
      value: function _getString(n) {
        var p = this.head;
        var c = 1;
        var ret = p.data;
        n -= ret.length;
  
        while (p = p.next) {
          var str = p.data;
          var nb = n > str.length ? str.length : n;
          if (nb === str.length) ret += str;else ret += str.slice(0, n);
          n -= nb;
  
          if (n === 0) {
            if (nb === str.length) {
              ++c;
              if (p.next) this.head = p.next;else this.head = this.tail = null;
            } else {
              this.head = p;
              p.data = str.slice(nb);
            }
  
            break;
          }
  
          ++c;
        }
  
        this.length -= c;
        return ret;
      } // Consumes a specified amount of bytes from the buffered data.
  
    }, {
      key: "_getBuffer",
      value: function _getBuffer(n) {
        var ret = Buffer.allocUnsafe(n);
        var p = this.head;
        var c = 1;
        p.data.copy(ret);
        n -= p.data.length;
  
        while (p = p.next) {
          var buf = p.data;
          var nb = n > buf.length ? buf.length : n;
          buf.copy(ret, ret.length - n, 0, nb);
          n -= nb;
  
          if (n === 0) {
            if (nb === buf.length) {
              ++c;
              if (p.next) this.head = p.next;else this.head = this.tail = null;
            } else {
              this.head = p;
              p.data = buf.slice(nb);
            }
  
            break;
          }
  
          ++c;
        }
  
        this.length -= c;
        return ret;
      } // Make sure the linked list only shows the minimal necessary information.
  
    }, {
      key: custom,
      value: function value(_, options) {
        return inspect(this, _objectSpread({}, options, {
          // Only inspect one level.
          depth: 0,
          // It should not recurse.
          customInspect: false
        }));
      }
    }]);
  
    return BufferList;
  }();
  },{"buffer":3,"util":2}],29:[function(require,module,exports){
  (function (process){(function (){
  'use strict'; // undocumented cb() API, needed for core, not for public API
  
  function destroy(err, cb) {
    var _this = this;
  
    var readableDestroyed = this._readableState && this._readableState.destroyed;
    var writableDestroyed = this._writableState && this._writableState.destroyed;
  
    if (readableDestroyed || writableDestroyed) {
      if (cb) {
        cb(err);
      } else if (err) {
        if (!this._writableState) {
          process.nextTick(emitErrorNT, this, err);
        } else if (!this._writableState.errorEmitted) {
          this._writableState.errorEmitted = true;
          process.nextTick(emitErrorNT, this, err);
        }
      }
  
      return this;
    } // we set destroyed to true before firing error callbacks in order
    // to make it re-entrance safe in case destroy() is called within callbacks
  
  
    if (this._readableState) {
      this._readableState.destroyed = true;
    } // if this is a duplex stream mark the writable part as destroyed as well
  
  
    if (this._writableState) {
      this._writableState.destroyed = true;
    }
  
    this._destroy(err || null, function (err) {
      if (!cb && err) {
        if (!_this._writableState) {
          process.nextTick(emitErrorAndCloseNT, _this, err);
        } else if (!_this._writableState.errorEmitted) {
          _this._writableState.errorEmitted = true;
          process.nextTick(emitErrorAndCloseNT, _this, err);
        } else {
          process.nextTick(emitCloseNT, _this);
        }
      } else if (cb) {
        process.nextTick(emitCloseNT, _this);
        cb(err);
      } else {
        process.nextTick(emitCloseNT, _this);
      }
    });
  
    return this;
  }
  
  function emitErrorAndCloseNT(self, err) {
    emitErrorNT(self, err);
    emitCloseNT(self);
  }
  
  function emitCloseNT(self) {
    if (self._writableState && !self._writableState.emitClose) return;
    if (self._readableState && !self._readableState.emitClose) return;
    self.emit('close');
  }
  
  function undestroy() {
    if (this._readableState) {
      this._readableState.destroyed = false;
      this._readableState.reading = false;
      this._readableState.ended = false;
      this._readableState.endEmitted = false;
    }
  
    if (this._writableState) {
      this._writableState.destroyed = false;
      this._writableState.ended = false;
      this._writableState.ending = false;
      this._writableState.finalCalled = false;
      this._writableState.prefinished = false;
      this._writableState.finished = false;
      this._writableState.errorEmitted = false;
    }
  }
  
  function emitErrorNT(self, err) {
    self.emit('error', err);
  }
  
  function errorOrDestroy(stream, err) {
    // We have tests that rely on errors being emitted
    // in the same tick, so changing this is semver major.
    // For now when you opt-in to autoDestroy we allow
    // the error to be emitted nextTick. In a future
    // semver major update we should change the default to this.
    var rState = stream._readableState;
    var wState = stream._writableState;
    if (rState && rState.autoDestroy || wState && wState.autoDestroy) stream.destroy(err);else stream.emit('error', err);
  }
  
  module.exports = {
    destroy: destroy,
    undestroy: undestroy,
    errorOrDestroy: errorOrDestroy
  };
  }).call(this)}).call(this,require('_process'))
  },{"_process":11}],30:[function(require,module,exports){
  // Ported from https://github.com/mafintosh/end-of-stream with
  // permission from the author, Mathias Buus (@mafintosh).
  'use strict';
  
  var ERR_STREAM_PREMATURE_CLOSE = require('../../../errors').codes.ERR_STREAM_PREMATURE_CLOSE;
  
  function once(callback) {
    var called = false;
    return function () {
      if (called) return;
      called = true;
  
      for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }
  
      callback.apply(this, args);
    };
  }
  
  function noop() {}
  
  function isRequest(stream) {
    return stream.setHeader && typeof stream.abort === 'function';
  }
  
  function eos(stream, opts, callback) {
    if (typeof opts === 'function') return eos(stream, null, opts);
    if (!opts) opts = {};
    callback = once(callback || noop);
    var readable = opts.readable || opts.readable !== false && stream.readable;
    var writable = opts.writable || opts.writable !== false && stream.writable;
  
    var onlegacyfinish = function onlegacyfinish() {
      if (!stream.writable) onfinish();
    };
  
    var writableEnded = stream._writableState && stream._writableState.finished;
  
    var onfinish = function onfinish() {
      writable = false;
      writableEnded = true;
      if (!readable) callback.call(stream);
    };
  
    var readableEnded = stream._readableState && stream._readableState.endEmitted;
  
    var onend = function onend() {
      readable = false;
      readableEnded = true;
      if (!writable) callback.call(stream);
    };
  
    var onerror = function onerror(err) {
      callback.call(stream, err);
    };
  
    var onclose = function onclose() {
      var err;
  
      if (readable && !readableEnded) {
        if (!stream._readableState || !stream._readableState.ended) err = new ERR_STREAM_PREMATURE_CLOSE();
        return callback.call(stream, err);
      }
  
      if (writable && !writableEnded) {
        if (!stream._writableState || !stream._writableState.ended) err = new ERR_STREAM_PREMATURE_CLOSE();
        return callback.call(stream, err);
      }
    };
  
    var onrequest = function onrequest() {
      stream.req.on('finish', onfinish);
    };
  
    if (isRequest(stream)) {
      stream.on('complete', onfinish);
      stream.on('abort', onclose);
      if (stream.req) onrequest();else stream.on('request', onrequest);
    } else if (writable && !stream._writableState) {
      // legacy streams
      stream.on('end', onlegacyfinish);
      stream.on('close', onlegacyfinish);
    }
  
    stream.on('end', onend);
    stream.on('finish', onfinish);
    if (opts.error !== false) stream.on('error', onerror);
    stream.on('close', onclose);
    return function () {
      stream.removeListener('complete', onfinish);
      stream.removeListener('abort', onclose);
      stream.removeListener('request', onrequest);
      if (stream.req) stream.req.removeListener('finish', onfinish);
      stream.removeListener('end', onlegacyfinish);
      stream.removeListener('close', onlegacyfinish);
      stream.removeListener('finish', onfinish);
      stream.removeListener('end', onend);
      stream.removeListener('error', onerror);
      stream.removeListener('close', onclose);
    };
  }
  
  module.exports = eos;
  },{"../../../errors":21}],31:[function(require,module,exports){
  module.exports = function () {
    throw new Error('Readable.from is not available in the browser')
  };
  
  },{}],32:[function(require,module,exports){
  // Ported from https://github.com/mafintosh/pump with
  // permission from the author, Mathias Buus (@mafintosh).
  'use strict';
  
  var eos;
  
  function once(callback) {
    var called = false;
    return function () {
      if (called) return;
      called = true;
      callback.apply(void 0, arguments);
    };
  }
  
  var _require$codes = require('../../../errors').codes,
      ERR_MISSING_ARGS = _require$codes.ERR_MISSING_ARGS,
      ERR_STREAM_DESTROYED = _require$codes.ERR_STREAM_DESTROYED;
  
  function noop(err) {
    // Rethrow the error if it exists to avoid swallowing it
    if (err) throw err;
  }
  
  function isRequest(stream) {
    return stream.setHeader && typeof stream.abort === 'function';
  }
  
  function destroyer(stream, reading, writing, callback) {
    callback = once(callback);
    var closed = false;
    stream.on('close', function () {
      closed = true;
    });
    if (eos === undefined) eos = require('./end-of-stream');
    eos(stream, {
      readable: reading,
      writable: writing
    }, function (err) {
      if (err) return callback(err);
      closed = true;
      callback();
    });
    var destroyed = false;
    return function (err) {
      if (closed) return;
      if (destroyed) return;
      destroyed = true; // request.destroy just do .end - .abort is what we want
  
      if (isRequest(stream)) return stream.abort();
      if (typeof stream.destroy === 'function') return stream.destroy();
      callback(err || new ERR_STREAM_DESTROYED('pipe'));
    };
  }
  
  function call(fn) {
    fn();
  }
  
  function pipe(from, to) {
    return from.pipe(to);
  }
  
  function popCallback(streams) {
    if (!streams.length) return noop;
    if (typeof streams[streams.length - 1] !== 'function') return noop;
    return streams.pop();
  }
  
  function pipeline() {
    for (var _len = arguments.length, streams = new Array(_len), _key = 0; _key < _len; _key++) {
      streams[_key] = arguments[_key];
    }
  
    var callback = popCallback(streams);
    if (Array.isArray(streams[0])) streams = streams[0];
  
    if (streams.length < 2) {
      throw new ERR_MISSING_ARGS('streams');
    }
  
    var error;
    var destroys = streams.map(function (stream, i) {
      var reading = i < streams.length - 1;
      var writing = i > 0;
      return destroyer(stream, reading, writing, function (err) {
        if (!error) error = err;
        if (err) destroys.forEach(call);
        if (reading) return;
        destroys.forEach(call);
        callback(error);
      });
    });
    return streams.reduce(pipe);
  }
  
  module.exports = pipeline;
  },{"../../../errors":21,"./end-of-stream":30}],33:[function(require,module,exports){
  'use strict';
  
  var ERR_INVALID_OPT_VALUE = require('../../../errors').codes.ERR_INVALID_OPT_VALUE;
  
  function highWaterMarkFrom(options, isDuplex, duplexKey) {
    return options.highWaterMark != null ? options.highWaterMark : isDuplex ? options[duplexKey] : null;
  }
  
  function getHighWaterMark(state, options, duplexKey, isDuplex) {
    var hwm = highWaterMarkFrom(options, isDuplex, duplexKey);
  
    if (hwm != null) {
      if (!(isFinite(hwm) && Math.floor(hwm) === hwm) || hwm < 0) {
        var name = isDuplex ? duplexKey : 'highWaterMark';
        throw new ERR_INVALID_OPT_VALUE(name, hwm);
      }
  
      return Math.floor(hwm);
    } // Default value
  
  
    return state.objectMode ? 16 : 16 * 1024;
  }
  
  module.exports = {
    getHighWaterMark: getHighWaterMark
  };
  },{"../../../errors":21}],34:[function(require,module,exports){
  module.exports = require('events').EventEmitter;
  
  },{"events":5}],35:[function(require,module,exports){
  exports = module.exports = require('./lib/_stream_readable.js');
  exports.Stream = exports;
  exports.Readable = exports;
  exports.Writable = require('./lib/_stream_writable.js');
  exports.Duplex = require('./lib/_stream_duplex.js');
  exports.Transform = require('./lib/_stream_transform.js');
  exports.PassThrough = require('./lib/_stream_passthrough.js');
  exports.finished = require('./lib/internal/streams/end-of-stream.js');
  exports.pipeline = require('./lib/internal/streams/pipeline.js');
  
  },{"./lib/_stream_duplex.js":22,"./lib/_stream_passthrough.js":23,"./lib/_stream_readable.js":24,"./lib/_stream_transform.js":25,"./lib/_stream_writable.js":26,"./lib/internal/streams/end-of-stream.js":30,"./lib/internal/streams/pipeline.js":32}],36:[function(require,module,exports){
  // Copyright Joyent, Inc. and other Node contributors.
  //
  // Permission is hereby granted, free of charge, to any person obtaining a
  // copy of this software and associated documentation files (the
  // "Software"), to deal in the Software without restriction, including
  // without limitation the rights to use, copy, modify, merge, publish,
  // distribute, sublicense, and/or sell copies of the Software, and to permit
  // persons to whom the Software is furnished to do so, subject to the
  // following conditions:
  //
  // The above copyright notice and this permission notice shall be included
  // in all copies or substantial portions of the Software.
  //
  // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
  // OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  // MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
  // NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
  // DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  // OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
  // USE OR OTHER DEALINGS IN THE SOFTWARE.
  
  'use strict';
  
  /*<replacement>*/
  
  var Buffer = require('safe-buffer').Buffer;
  /*</replacement>*/
  
  var isEncoding = Buffer.isEncoding || function (encoding) {
    encoding = '' + encoding;
    switch (encoding && encoding.toLowerCase()) {
      case 'hex':case 'utf8':case 'utf-8':case 'ascii':case 'binary':case 'base64':case 'ucs2':case 'ucs-2':case 'utf16le':case 'utf-16le':case 'raw':
        return true;
      default:
        return false;
    }
  };
  
  function _normalizeEncoding(enc) {
    if (!enc) return 'utf8';
    var retried;
    while (true) {
      switch (enc) {
        case 'utf8':
        case 'utf-8':
          return 'utf8';
        case 'ucs2':
        case 'ucs-2':
        case 'utf16le':
        case 'utf-16le':
          return 'utf16le';
        case 'latin1':
        case 'binary':
          return 'latin1';
        case 'base64':
        case 'ascii':
        case 'hex':
          return enc;
        default:
          if (retried) return; // undefined
          enc = ('' + enc).toLowerCase();
          retried = true;
      }
    }
  };
  
  // Do not cache `Buffer.isEncoding` when checking encoding names as some
  // modules monkey-patch it to support additional encodings
  function normalizeEncoding(enc) {
    var nenc = _normalizeEncoding(enc);
    if (typeof nenc !== 'string' && (Buffer.isEncoding === isEncoding || !isEncoding(enc))) throw new Error('Unknown encoding: ' + enc);
    return nenc || enc;
  }
  
  // StringDecoder provides an interface for efficiently splitting a series of
  // buffers into a series of JS strings without breaking apart multi-byte
  // characters.
  exports.StringDecoder = StringDecoder;
  function StringDecoder(encoding) {
    this.encoding = normalizeEncoding(encoding);
    var nb;
    switch (this.encoding) {
      case 'utf16le':
        this.text = utf16Text;
        this.end = utf16End;
        nb = 4;
        break;
      case 'utf8':
        this.fillLast = utf8FillLast;
        nb = 4;
        break;
      case 'base64':
        this.text = base64Text;
        this.end = base64End;
        nb = 3;
        break;
      default:
        this.write = simpleWrite;
        this.end = simpleEnd;
        return;
    }
    this.lastNeed = 0;
    this.lastTotal = 0;
    this.lastChar = Buffer.allocUnsafe(nb);
  }
  
  StringDecoder.prototype.write = function (buf) {
    if (buf.length === 0) return '';
    var r;
    var i;
    if (this.lastNeed) {
      r = this.fillLast(buf);
      if (r === undefined) return '';
      i = this.lastNeed;
      this.lastNeed = 0;
    } else {
      i = 0;
    }
    if (i < buf.length) return r ? r + this.text(buf, i) : this.text(buf, i);
    return r || '';
  };
  
  StringDecoder.prototype.end = utf8End;
  
  // Returns only complete characters in a Buffer
  StringDecoder.prototype.text = utf8Text;
  
  // Attempts to complete a partial non-UTF-8 character using bytes from a Buffer
  StringDecoder.prototype.fillLast = function (buf) {
    if (this.lastNeed <= buf.length) {
      buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, this.lastNeed);
      return this.lastChar.toString(this.encoding, 0, this.lastTotal);
    }
    buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, buf.length);
    this.lastNeed -= buf.length;
  };
  
  // Checks the type of a UTF-8 byte, whether it's ASCII, a leading byte, or a
  // continuation byte. If an invalid byte is detected, -2 is returned.
  function utf8CheckByte(byte) {
    if (byte <= 0x7F) return 0;else if (byte >> 5 === 0x06) return 2;else if (byte >> 4 === 0x0E) return 3;else if (byte >> 3 === 0x1E) return 4;
    return byte >> 6 === 0x02 ? -1 : -2;
  }
  
  // Checks at most 3 bytes at the end of a Buffer in order to detect an
  // incomplete multi-byte UTF-8 character. The total number of bytes (2, 3, or 4)
  // needed to complete the UTF-8 character (if applicable) are returned.
  function utf8CheckIncomplete(self, buf, i) {
    var j = buf.length - 1;
    if (j < i) return 0;
    var nb = utf8CheckByte(buf[j]);
    if (nb >= 0) {
      if (nb > 0) self.lastNeed = nb - 1;
      return nb;
    }
    if (--j < i || nb === -2) return 0;
    nb = utf8CheckByte(buf[j]);
    if (nb >= 0) {
      if (nb > 0) self.lastNeed = nb - 2;
      return nb;
    }
    if (--j < i || nb === -2) return 0;
    nb = utf8CheckByte(buf[j]);
    if (nb >= 0) {
      if (nb > 0) {
        if (nb === 2) nb = 0;else self.lastNeed = nb - 3;
      }
      return nb;
    }
    return 0;
  }
  
  // Validates as many continuation bytes for a multi-byte UTF-8 character as
  // needed or are available. If we see a non-continuation byte where we expect
  // one, we "replace" the validated continuation bytes we've seen so far with
  // a single UTF-8 replacement character ('\ufffd'), to match v8's UTF-8 decoding
  // behavior. The continuation byte check is included three times in the case
  // where all of the continuation bytes for a character exist in the same buffer.
  // It is also done this way as a slight performance increase instead of using a
  // loop.
  function utf8CheckExtraBytes(self, buf, p) {
    if ((buf[0] & 0xC0) !== 0x80) {
      self.lastNeed = 0;
      return '\ufffd';
    }
    if (self.lastNeed > 1 && buf.length > 1) {
      if ((buf[1] & 0xC0) !== 0x80) {
        self.lastNeed = 1;
        return '\ufffd';
      }
      if (self.lastNeed > 2 && buf.length > 2) {
        if ((buf[2] & 0xC0) !== 0x80) {
          self.lastNeed = 2;
          return '\ufffd';
        }
      }
    }
  }
  
  // Attempts to complete a multi-byte UTF-8 character using bytes from a Buffer.
  function utf8FillLast(buf) {
    var p = this.lastTotal - this.lastNeed;
    var r = utf8CheckExtraBytes(this, buf, p);
    if (r !== undefined) return r;
    if (this.lastNeed <= buf.length) {
      buf.copy(this.lastChar, p, 0, this.lastNeed);
      return this.lastChar.toString(this.encoding, 0, this.lastTotal);
    }
    buf.copy(this.lastChar, p, 0, buf.length);
    this.lastNeed -= buf.length;
  }
  
  // Returns all complete UTF-8 characters in a Buffer. If the Buffer ended on a
  // partial character, the character's bytes are buffered until the required
  // number of bytes are available.
  function utf8Text(buf, i) {
    var total = utf8CheckIncomplete(this, buf, i);
    if (!this.lastNeed) return buf.toString('utf8', i);
    this.lastTotal = total;
    var end = buf.length - (total - this.lastNeed);
    buf.copy(this.lastChar, 0, end);
    return buf.toString('utf8', i, end);
  }
  
  // For UTF-8, a replacement character is added when ending on a partial
  // character.
  function utf8End(buf) {
    var r = buf && buf.length ? this.write(buf) : '';
    if (this.lastNeed) return r + '\ufffd';
    return r;
  }
  
  // UTF-16LE typically needs two bytes per character, but even if we have an even
  // number of bytes available, we need to check if we end on a leading/high
  // surrogate. In that case, we need to wait for the next two bytes in order to
  // decode the last character properly.
  function utf16Text(buf, i) {
    if ((buf.length - i) % 2 === 0) {
      var r = buf.toString('utf16le', i);
      if (r) {
        var c = r.charCodeAt(r.length - 1);
        if (c >= 0xD800 && c <= 0xDBFF) {
          this.lastNeed = 2;
          this.lastTotal = 4;
          this.lastChar[0] = buf[buf.length - 2];
          this.lastChar[1] = buf[buf.length - 1];
          return r.slice(0, -1);
        }
      }
      return r;
    }
    this.lastNeed = 1;
    this.lastTotal = 2;
    this.lastChar[0] = buf[buf.length - 1];
    return buf.toString('utf16le', i, buf.length - 1);
  }
  
  // For UTF-16LE we do not explicitly append special replacement characters if we
  // end on a partial character, we simply let v8 handle that.
  function utf16End(buf) {
    var r = buf && buf.length ? this.write(buf) : '';
    if (this.lastNeed) {
      var end = this.lastTotal - this.lastNeed;
      return r + this.lastChar.toString('utf16le', 0, end);
    }
    return r;
  }
  
  function base64Text(buf, i) {
    var n = (buf.length - i) % 3;
    if (n === 0) return buf.toString('base64', i);
    this.lastNeed = 3 - n;
    this.lastTotal = 3;
    if (n === 1) {
      this.lastChar[0] = buf[buf.length - 1];
    } else {
      this.lastChar[0] = buf[buf.length - 2];
      this.lastChar[1] = buf[buf.length - 1];
    }
    return buf.toString('base64', i, buf.length - n);
  }
  
  function base64End(buf) {
    var r = buf && buf.length ? this.write(buf) : '';
    if (this.lastNeed) return r + this.lastChar.toString('base64', 0, 3 - this.lastNeed);
    return r;
  }
  
  // Pass bytes on through for single-byte encodings (e.g. ascii, latin1, hex)
  function simpleWrite(buf) {
    return buf.toString(this.encoding);
  }
  
  function simpleEnd(buf) {
    return buf && buf.length ? this.write(buf) : '';
  }
  },{"safe-buffer":16}],37:[function(require,module,exports){
  // Copyright Joyent, Inc. and other Node contributors.
  //
  // Permission is hereby granted, free of charge, to any person obtaining a
  // copy of this software and associated documentation files (the
  // "Software"), to deal in the Software without restriction, including
  // without limitation the rights to use, copy, modify, merge, publish,
  // distribute, sublicense, and/or sell copies of the Software, and to permit
  // persons to whom the Software is furnished to do so, subject to the
  // following conditions:
  //
  // The above copyright notice and this permission notice shall be included
  // in all copies or substantial portions of the Software.
  //
  // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
  // OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  // MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
  // NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
  // DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  // OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
  // USE OR OTHER DEALINGS IN THE SOFTWARE.
  
  'use strict';
  
  var punycode = require('punycode');
  var util = require('./util');
  
  exports.parse = urlParse;
  exports.resolve = urlResolve;
  exports.resolveObject = urlResolveObject;
  exports.format = urlFormat;
  
  exports.Url = Url;
  
  function Url() {
    this.protocol = null;
    this.slashes = null;
    this.auth = null;
    this.host = null;
    this.port = null;
    this.hostname = null;
    this.hash = null;
    this.search = null;
    this.query = null;
    this.pathname = null;
    this.path = null;
    this.href = null;
  }
  
  // Reference: RFC 3986, RFC 1808, RFC 2396
  
  // define these here so at least they only have to be
  // compiled once on the first module load.
  var protocolPattern = /^([a-z0-9.+-]+:)/i,
      portPattern = /:[0-9]*$/,
  
      // Special case for a simple path URL
      simplePathPattern = /^(\/\/?(?!\/)[^\?\s]*)(\?[^\s]*)?$/,
  
      // RFC 2396: characters reserved for delimiting URLs.
      // We actually just auto-escape these.
      delims = ['<', '>', '"', '`', ' ', '\r', '\n', '\t'],
  
      // RFC 2396: characters not allowed for various reasons.
      unwise = ['{', '}', '|', '\\', '^', '`'].concat(delims),
  
      // Allowed by RFCs, but cause of XSS attacks.  Always escape these.
      autoEscape = ['\''].concat(unwise),
      // Characters that are never ever allowed in a hostname.
      // Note that any invalid chars are also handled, but these
      // are the ones that are *expected* to be seen, so we fast-path
      // them.
      nonHostChars = ['%', '/', '?', ';', '#'].concat(autoEscape),
      hostEndingChars = ['/', '?', '#'],
      hostnameMaxLen = 255,
      hostnamePartPattern = /^[+a-z0-9A-Z_-]{0,63}$/,
      hostnamePartStart = /^([+a-z0-9A-Z_-]{0,63})(.*)$/,
      // protocols that can allow "unsafe" and "unwise" chars.
      unsafeProtocol = {
        'javascript': true,
        'javascript:': true
      },
      // protocols that never have a hostname.
      hostlessProtocol = {
        'javascript': true,
        'javascript:': true
      },
      // protocols that always contain a // bit.
      slashedProtocol = {
        'http': true,
        'https': true,
        'ftp': true,
        'gopher': true,
        'file': true,
        'http:': true,
        'https:': true,
        'ftp:': true,
        'gopher:': true,
        'file:': true
      },
      querystring = require('querystring');
  
  function urlParse(url, parseQueryString, slashesDenoteHost) {
    if (url && util.isObject(url) && url instanceof Url) return url;
  
    var u = new Url;
    u.parse(url, parseQueryString, slashesDenoteHost);
    return u;
  }
  
  Url.prototype.parse = function(url, parseQueryString, slashesDenoteHost) {
    if (!util.isString(url)) {
      throw new TypeError("Parameter 'url' must be a string, not " + typeof url);
    }
  
    // Copy chrome, IE, opera backslash-handling behavior.
    // Back slashes before the query string get converted to forward slashes
    // See: https://code.google.com/p/chromium/issues/detail?id=25916
    var queryIndex = url.indexOf('?'),
        splitter =
            (queryIndex !== -1 && queryIndex < url.indexOf('#')) ? '?' : '#',
        uSplit = url.split(splitter),
        slashRegex = /\\/g;
    uSplit[0] = uSplit[0].replace(slashRegex, '/');
    url = uSplit.join(splitter);
  
    var rest = url;
  
    // trim before proceeding.
    // This is to support parse stuff like "  http://foo.com  \n"
    rest = rest.trim();
  
    if (!slashesDenoteHost && url.split('#').length === 1) {
      // Try fast path regexp
      var simplePath = simplePathPattern.exec(rest);
      if (simplePath) {
        this.path = rest;
        this.href = rest;
        this.pathname = simplePath[1];
        if (simplePath[2]) {
          this.search = simplePath[2];
          if (parseQueryString) {
            this.query = querystring.parse(this.search.substr(1));
          } else {
            this.query = this.search.substr(1);
          }
        } else if (parseQueryString) {
          this.search = '';
          this.query = {};
        }
        return this;
      }
    }
  
    var proto = protocolPattern.exec(rest);
    if (proto) {
      proto = proto[0];
      var lowerProto = proto.toLowerCase();
      this.protocol = lowerProto;
      rest = rest.substr(proto.length);
    }
  
    // figure out if it's got a host
    // user@server is *always* interpreted as a hostname, and url
    // resolution will treat //foo/bar as host=foo,path=bar because that's
    // how the browser resolves relative URLs.
    if (slashesDenoteHost || proto || rest.match(/^\/\/[^@\/]+@[^@\/]+/)) {
      var slashes = rest.substr(0, 2) === '//';
      if (slashes && !(proto && hostlessProtocol[proto])) {
        rest = rest.substr(2);
        this.slashes = true;
      }
    }
  
    if (!hostlessProtocol[proto] &&
        (slashes || (proto && !slashedProtocol[proto]))) {
  
      // there's a hostname.
      // the first instance of /, ?, ;, or # ends the host.
      //
      // If there is an @ in the hostname, then non-host chars *are* allowed
      // to the left of the last @ sign, unless some host-ending character
      // comes *before* the @-sign.
      // URLs are obnoxious.
      //
      // ex:
      // http://a@b@c/ => user:a@b host:c
      // http://a@b?@c => user:a host:c path:/?@c
  
      // v0.12 TODO(isaacs): This is not quite how Chrome does things.
      // Review our test case against browsers more comprehensively.
  
      // find the first instance of any hostEndingChars
      var hostEnd = -1;
      for (var i = 0; i < hostEndingChars.length; i++) {
        var hec = rest.indexOf(hostEndingChars[i]);
        if (hec !== -1 && (hostEnd === -1 || hec < hostEnd))
          hostEnd = hec;
      }
  
      // at this point, either we have an explicit point where the
      // auth portion cannot go past, or the last @ char is the decider.
      var auth, atSign;
      if (hostEnd === -1) {
        // atSign can be anywhere.
        atSign = rest.lastIndexOf('@');
      } else {
        // atSign must be in auth portion.
        // http://a@b/c@d => host:b auth:a path:/c@d
        atSign = rest.lastIndexOf('@', hostEnd);
      }
  
      // Now we have a portion which is definitely the auth.
      // Pull that off.
      if (atSign !== -1) {
        auth = rest.slice(0, atSign);
        rest = rest.slice(atSign + 1);
        this.auth = decodeURIComponent(auth);
      }
  
      // the host is the remaining to the left of the first non-host char
      hostEnd = -1;
      for (var i = 0; i < nonHostChars.length; i++) {
        var hec = rest.indexOf(nonHostChars[i]);
        if (hec !== -1 && (hostEnd === -1 || hec < hostEnd))
          hostEnd = hec;
      }
      // if we still have not hit it, then the entire thing is a host.
      if (hostEnd === -1)
        hostEnd = rest.length;
  
      this.host = rest.slice(0, hostEnd);
      rest = rest.slice(hostEnd);
  
      // pull out port.
      this.parseHost();
  
      // we've indicated that there is a hostname,
      // so even if it's empty, it has to be present.
      this.hostname = this.hostname || '';
  
      // if hostname begins with [ and ends with ]
      // assume that it's an IPv6 address.
      var ipv6Hostname = this.hostname[0] === '[' &&
          this.hostname[this.hostname.length - 1] === ']';
  
      // validate a little.
      if (!ipv6Hostname) {
        var hostparts = this.hostname.split(/\./);
        for (var i = 0, l = hostparts.length; i < l; i++) {
          var part = hostparts[i];
          if (!part) continue;
          if (!part.match(hostnamePartPattern)) {
            var newpart = '';
            for (var j = 0, k = part.length; j < k; j++) {
              if (part.charCodeAt(j) > 127) {
                // we replace non-ASCII char with a temporary placeholder
                // we need this to make sure size of hostname is not
                // broken by replacing non-ASCII by nothing
                newpart += 'x';
              } else {
                newpart += part[j];
              }
            }
            // we test again with ASCII char only
            if (!newpart.match(hostnamePartPattern)) {
              var validParts = hostparts.slice(0, i);
              var notHost = hostparts.slice(i + 1);
              var bit = part.match(hostnamePartStart);
              if (bit) {
                validParts.push(bit[1]);
                notHost.unshift(bit[2]);
              }
              if (notHost.length) {
                rest = '/' + notHost.join('.') + rest;
              }
              this.hostname = validParts.join('.');
              break;
            }
          }
        }
      }
  
      if (this.hostname.length > hostnameMaxLen) {
        this.hostname = '';
      } else {
        // hostnames are always lower case.
        this.hostname = this.hostname.toLowerCase();
      }
  
      if (!ipv6Hostname) {
        // IDNA Support: Returns a punycoded representation of "domain".
        // It only converts parts of the domain name that
        // have non-ASCII characters, i.e. it doesn't matter if
        // you call it with a domain that already is ASCII-only.
        this.hostname = punycode.toASCII(this.hostname);
      }
  
      var p = this.port ? ':' + this.port : '';
      var h = this.hostname || '';
      this.host = h + p;
      this.href += this.host;
  
      // strip [ and ] from the hostname
      // the host field still retains them, though
      if (ipv6Hostname) {
        this.hostname = this.hostname.substr(1, this.hostname.length - 2);
        if (rest[0] !== '/') {
          rest = '/' + rest;
        }
      }
    }
  
    // now rest is set to the post-host stuff.
    // chop off any delim chars.
    if (!unsafeProtocol[lowerProto]) {
  
      // First, make 100% sure that any "autoEscape" chars get
      // escaped, even if encodeURIComponent doesn't think they
      // need to be.
      for (var i = 0, l = autoEscape.length; i < l; i++) {
        var ae = autoEscape[i];
        if (rest.indexOf(ae) === -1)
          continue;
        var esc = encodeURIComponent(ae);
        if (esc === ae) {
          esc = escape(ae);
        }
        rest = rest.split(ae).join(esc);
      }
    }
  
  
    // chop off from the tail first.
    var hash = rest.indexOf('#');
    if (hash !== -1) {
      // got a fragment string.
      this.hash = rest.substr(hash);
      rest = rest.slice(0, hash);
    }
    var qm = rest.indexOf('?');
    if (qm !== -1) {
      this.search = rest.substr(qm);
      this.query = rest.substr(qm + 1);
      if (parseQueryString) {
        this.query = querystring.parse(this.query);
      }
      rest = rest.slice(0, qm);
    } else if (parseQueryString) {
      // no query string, but parseQueryString still requested
      this.search = '';
      this.query = {};
    }
    if (rest) this.pathname = rest;
    if (slashedProtocol[lowerProto] &&
        this.hostname && !this.pathname) {
      this.pathname = '/';
    }
  
    //to support http.request
    if (this.pathname || this.search) {
      var p = this.pathname || '';
      var s = this.search || '';
      this.path = p + s;
    }
  
    // finally, reconstruct the href based on what has been validated.
    this.href = this.format();
    return this;
  };
  
  // format a parsed object into a url string
  function urlFormat(obj) {
    // ensure it's an object, and not a string url.
    // If it's an obj, this is a no-op.
    // this way, you can call url_format() on strings
    // to clean up potentially wonky urls.
    if (util.isString(obj)) obj = urlParse(obj);
    if (!(obj instanceof Url)) return Url.prototype.format.call(obj);
    return obj.format();
  }
  
  Url.prototype.format = function() {
    var auth = this.auth || '';
    if (auth) {
      auth = encodeURIComponent(auth);
      auth = auth.replace(/%3A/i, ':');
      auth += '@';
    }
  
    var protocol = this.protocol || '',
        pathname = this.pathname || '',
        hash = this.hash || '',
        host = false,
        query = '';
  
    if (this.host) {
      host = auth + this.host;
    } else if (this.hostname) {
      host = auth + (this.hostname.indexOf(':') === -1 ?
          this.hostname :
          '[' + this.hostname + ']');
      if (this.port) {
        host += ':' + this.port;
      }
    }
  
    if (this.query &&
        util.isObject(this.query) &&
        Object.keys(this.query).length) {
      query = querystring.stringify(this.query);
    }
  
    var search = this.search || (query && ('?' + query)) || '';
  
    if (protocol && protocol.substr(-1) !== ':') protocol += ':';
  
    // only the slashedProtocols get the //.  Not mailto:, xmpp:, etc.
    // unless they had them to begin with.
    if (this.slashes ||
        (!protocol || slashedProtocol[protocol]) && host !== false) {
      host = '//' + (host || '');
      if (pathname && pathname.charAt(0) !== '/') pathname = '/' + pathname;
    } else if (!host) {
      host = '';
    }
  
    if (hash && hash.charAt(0) !== '#') hash = '#' + hash;
    if (search && search.charAt(0) !== '?') search = '?' + search;
  
    pathname = pathname.replace(/[?#]/g, function(match) {
      return encodeURIComponent(match);
    });
    search = search.replace('#', '%23');
  
    return protocol + host + pathname + search + hash;
  };
  
  function urlResolve(source, relative) {
    return urlParse(source, false, true).resolve(relative);
  }
  
  Url.prototype.resolve = function(relative) {
    return this.resolveObject(urlParse(relative, false, true)).format();
  };
  
  function urlResolveObject(source, relative) {
    if (!source) return relative;
    return urlParse(source, false, true).resolveObject(relative);
  }
  
  Url.prototype.resolveObject = function(relative) {
    if (util.isString(relative)) {
      var rel = new Url();
      rel.parse(relative, false, true);
      relative = rel;
    }
  
    var result = new Url();
    var tkeys = Object.keys(this);
    for (var tk = 0; tk < tkeys.length; tk++) {
      var tkey = tkeys[tk];
      result[tkey] = this[tkey];
    }
  
    // hash is always overridden, no matter what.
    // even href="" will remove it.
    result.hash = relative.hash;
  
    // if the relative url is empty, then there's nothing left to do here.
    if (relative.href === '') {
      result.href = result.format();
      return result;
    }
  
    // hrefs like //foo/bar always cut to the protocol.
    if (relative.slashes && !relative.protocol) {
      // take everything except the protocol from relative
      var rkeys = Object.keys(relative);
      for (var rk = 0; rk < rkeys.length; rk++) {
        var rkey = rkeys[rk];
        if (rkey !== 'protocol')
          result[rkey] = relative[rkey];
      }
  
      //urlParse appends trailing / to urls like http://www.example.com
      if (slashedProtocol[result.protocol] &&
          result.hostname && !result.pathname) {
        result.path = result.pathname = '/';
      }
  
      result.href = result.format();
      return result;
    }
  
    if (relative.protocol && relative.protocol !== result.protocol) {
      // if it's a known url protocol, then changing
      // the protocol does weird things
      // first, if it's not file:, then we MUST have a host,
      // and if there was a path
      // to begin with, then we MUST have a path.
      // if it is file:, then the host is dropped,
      // because that's known to be hostless.
      // anything else is assumed to be absolute.
      if (!slashedProtocol[relative.protocol]) {
        var keys = Object.keys(relative);
        for (var v = 0; v < keys.length; v++) {
          var k = keys[v];
          result[k] = relative[k];
        }
        result.href = result.format();
        return result;
      }
  
      result.protocol = relative.protocol;
      if (!relative.host && !hostlessProtocol[relative.protocol]) {
        var relPath = (relative.pathname || '').split('/');
        while (relPath.length && !(relative.host = relPath.shift()));
        if (!relative.host) relative.host = '';
        if (!relative.hostname) relative.hostname = '';
        if (relPath[0] !== '') relPath.unshift('');
        if (relPath.length < 2) relPath.unshift('');
        result.pathname = relPath.join('/');
      } else {
        result.pathname = relative.pathname;
      }
      result.search = relative.search;
      result.query = relative.query;
      result.host = relative.host || '';
      result.auth = relative.auth;
      result.hostname = relative.hostname || relative.host;
      result.port = relative.port;
      // to support http.request
      if (result.pathname || result.search) {
        var p = result.pathname || '';
        var s = result.search || '';
        result.path = p + s;
      }
      result.slashes = result.slashes || relative.slashes;
      result.href = result.format();
      return result;
    }
  
    var isSourceAbs = (result.pathname && result.pathname.charAt(0) === '/'),
        isRelAbs = (
            relative.host ||
            relative.pathname && relative.pathname.charAt(0) === '/'
        ),
        mustEndAbs = (isRelAbs || isSourceAbs ||
                      (result.host && relative.pathname)),
        removeAllDots = mustEndAbs,
        srcPath = result.pathname && result.pathname.split('/') || [],
        relPath = relative.pathname && relative.pathname.split('/') || [],
        psychotic = result.protocol && !slashedProtocol[result.protocol];
  
    // if the url is a non-slashed url, then relative
    // links like ../.. should be able
    // to crawl up to the hostname, as well.  This is strange.
    // result.protocol has already been set by now.
    // Later on, put the first path part into the host field.
    if (psychotic) {
      result.hostname = '';
      result.port = null;
      if (result.host) {
        if (srcPath[0] === '') srcPath[0] = result.host;
        else srcPath.unshift(result.host);
      }
      result.host = '';
      if (relative.protocol) {
        relative.hostname = null;
        relative.port = null;
        if (relative.host) {
          if (relPath[0] === '') relPath[0] = relative.host;
          else relPath.unshift(relative.host);
        }
        relative.host = null;
      }
      mustEndAbs = mustEndAbs && (relPath[0] === '' || srcPath[0] === '');
    }
  
    if (isRelAbs) {
      // it's absolute.
      result.host = (relative.host || relative.host === '') ?
                    relative.host : result.host;
      result.hostname = (relative.hostname || relative.hostname === '') ?
                        relative.hostname : result.hostname;
      result.search = relative.search;
      result.query = relative.query;
      srcPath = relPath;
      // fall through to the dot-handling below.
    } else if (relPath.length) {
      // it's relative
      // throw away the existing file, and take the new path instead.
      if (!srcPath) srcPath = [];
      srcPath.pop();
      srcPath = srcPath.concat(relPath);
      result.search = relative.search;
      result.query = relative.query;
    } else if (!util.isNullOrUndefined(relative.search)) {
      // just pull out the search.
      // like href='?foo'.
      // Put this after the other two cases because it simplifies the booleans
      if (psychotic) {
        result.hostname = result.host = srcPath.shift();
        //occationaly the auth can get stuck only in host
        //this especially happens in cases like
        //url.resolveObject('mailto:local1@domain1', 'local2@domain2')
        var authInHost = result.host && result.host.indexOf('@') > 0 ?
                         result.host.split('@') : false;
        if (authInHost) {
          result.auth = authInHost.shift();
          result.host = result.hostname = authInHost.shift();
        }
      }
      result.search = relative.search;
      result.query = relative.query;
      //to support http.request
      if (!util.isNull(result.pathname) || !util.isNull(result.search)) {
        result.path = (result.pathname ? result.pathname : '') +
                      (result.search ? result.search : '');
      }
      result.href = result.format();
      return result;
    }
  
    if (!srcPath.length) {
      // no path at all.  easy.
      // we've already handled the other stuff above.
      result.pathname = null;
      //to support http.request
      if (result.search) {
        result.path = '/' + result.search;
      } else {
        result.path = null;
      }
      result.href = result.format();
      return result;
    }
  
    // if a url ENDs in . or .., then it must get a trailing slash.
    // however, if it ends in anything else non-slashy,
    // then it must NOT get a trailing slash.
    var last = srcPath.slice(-1)[0];
    var hasTrailingSlash = (
        (result.host || relative.host || srcPath.length > 1) &&
        (last === '.' || last === '..') || last === '');
  
    // strip single dots, resolve double dots to parent dir
    // if the path tries to go above the root, `up` ends up > 0
    var up = 0;
    for (var i = srcPath.length; i >= 0; i--) {
      last = srcPath[i];
      if (last === '.') {
        srcPath.splice(i, 1);
      } else if (last === '..') {
        srcPath.splice(i, 1);
        up++;
      } else if (up) {
        srcPath.splice(i, 1);
        up--;
      }
    }
  
    // if the path is allowed to go above the root, restore leading ..s
    if (!mustEndAbs && !removeAllDots) {
      for (; up--; up) {
        srcPath.unshift('..');
      }
    }
  
    if (mustEndAbs && srcPath[0] !== '' &&
        (!srcPath[0] || srcPath[0].charAt(0) !== '/')) {
      srcPath.unshift('');
    }
  
    if (hasTrailingSlash && (srcPath.join('/').substr(-1) !== '/')) {
      srcPath.push('');
    }
  
    var isAbsolute = srcPath[0] === '' ||
        (srcPath[0] && srcPath[0].charAt(0) === '/');
  
    // put the host back
    if (psychotic) {
      result.hostname = result.host = isAbsolute ? '' :
                                      srcPath.length ? srcPath.shift() : '';
      //occationaly the auth can get stuck only in host
      //this especially happens in cases like
      //url.resolveObject('mailto:local1@domain1', 'local2@domain2')
      var authInHost = result.host && result.host.indexOf('@') > 0 ?
                       result.host.split('@') : false;
      if (authInHost) {
        result.auth = authInHost.shift();
        result.host = result.hostname = authInHost.shift();
      }
    }
  
    mustEndAbs = mustEndAbs || (result.host && srcPath.length);
  
    if (mustEndAbs && !isAbsolute) {
      srcPath.unshift('');
    }
  
    if (!srcPath.length) {
      result.pathname = null;
      result.path = null;
    } else {
      result.pathname = srcPath.join('/');
    }
  
    //to support request.http
    if (!util.isNull(result.pathname) || !util.isNull(result.search)) {
      result.path = (result.pathname ? result.pathname : '') +
                    (result.search ? result.search : '');
    }
    result.auth = relative.auth || result.auth;
    result.slashes = result.slashes || relative.slashes;
    result.href = result.format();
    return result;
  };
  
  Url.prototype.parseHost = function() {
    var host = this.host;
    var port = portPattern.exec(host);
    if (port) {
      port = port[0];
      if (port !== ':') {
        this.port = port.substr(1);
      }
      host = host.substr(0, host.length - port.length);
    }
    if (host) this.hostname = host;
  };
  
  },{"./util":38,"punycode":12,"querystring":15}],38:[function(require,module,exports){
  'use strict';
  
  module.exports = {
    isString: function(arg) {
      return typeof(arg) === 'string';
    },
    isObject: function(arg) {
      return typeof(arg) === 'object' && arg !== null;
    },
    isNull: function(arg) {
      return arg === null;
    },
    isNullOrUndefined: function(arg) {
      return arg == null;
    }
  };
  
  },{}],39:[function(require,module,exports){
  (function (global){(function (){
  
  /**
   * Module exports.
   */
  
  module.exports = deprecate;
  
  /**
   * Mark that a method should not be used.
   * Returns a modified function which warns once by default.
   *
   * If `localStorage.noDeprecation = true` is set, then it is a no-op.
   *
   * If `localStorage.throwDeprecation = true` is set, then deprecated functions
   * will throw an Error when invoked.
   *
   * If `localStorage.traceDeprecation = true` is set, then deprecated functions
   * will invoke `console.trace()` instead of `console.error()`.
   *
   * @param {Function} fn - the function to deprecate
   * @param {String} msg - the string to print to the console when `fn` is invoked
   * @returns {Function} a new "deprecated" version of `fn`
   * @api public
   */
  
  function deprecate (fn, msg) {
    if (config('noDeprecation')) {
      return fn;
    }
  
    var warned = false;
    function deprecated() {
      if (!warned) {
        if (config('throwDeprecation')) {
          throw new Error(msg);
        } else if (config('traceDeprecation')) {
          console.trace(msg);
        } else {
          console.warn(msg);
        }
        warned = true;
      }
      return fn.apply(this, arguments);
    }
  
    return deprecated;
  }
  
  /**
   * Checks `localStorage` for boolean values for the given `name`.
   *
   * @param {String} name
   * @returns {Boolean}
   * @api private
   */
  
  function config (name) {
    // accessing global.localStorage can trigger a DOMException in sandboxed iframes
    try {
      if (!global.localStorage) return false;
    } catch (_) {
      return false;
    }
    var val = global.localStorage[name];
    if (null == val) return false;
    return String(val).toLowerCase() === 'true';
  }
  
  }).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
  },{}],40:[function(require,module,exports){
  module.exports = extend
  
  var hasOwnProperty = Object.prototype.hasOwnProperty;
  
  function extend() {
      var target = {}
  
      for (var i = 0; i < arguments.length; i++) {
          var source = arguments[i]
  
          for (var key in source) {
              if (hasOwnProperty.call(source, key)) {
                  target[key] = source[key]
              }
          }
      }
  
      return target
  }
  
  },{}],41:[function(require,module,exports){
  /**
   * Copyright 2018 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the 'License');
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an 'AS IS' BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  
  /**
   * @typedef {Object} SerializedAXNode
   * @property {string} role
   *
   * @property {string=} name
   * @property {string|number=} value
   * @property {string=} description
   *
   * @property {string=} keyshortcuts
   * @property {string=} roledescription
   * @property {string=} valuetext
   *
   * @property {boolean=} disabled
   * @property {boolean=} expanded
   * @property {boolean=} focused
   * @property {boolean=} modal
   * @property {boolean=} multiline
   * @property {boolean=} multiselectable
   * @property {boolean=} readonly
   * @property {boolean=} required
   * @property {boolean=} selected
   *
   * @property {boolean|"mixed"=} checked
   * @property {boolean|"mixed"=} pressed
   *
   * @property {number=} level
   * @property {number=} valuemin
   * @property {number=} valuemax
   *
   * @property {string=} autocomplete
   * @property {string=} haspopup
   * @property {string=} invalid
   * @property {string=} orientation
   *
   * @property {Array<SerializedAXNode>=} children
   */
  
  class Accessibility {
    /**
     * @param {!Puppeteer.CDPSession} client
     */
    constructor(client) {
      this._client = client;
    }
  
    /**
     * @param {{interestingOnly?: boolean, root?: ?Puppeteer.ElementHandle}=} options
     * @return {!Promise<!SerializedAXNode>}
     */
    async snapshot(options = {}) {
      const {
        interestingOnly = true,
        root = null,
      } = options;
      const {nodes} = await this._client.send('Accessibility.getFullAXTree');
      let backendNodeId = null;
      if (root) {
        const {node} = await this._client.send('DOM.describeNode', {objectId: root._remoteObject.objectId});
        backendNodeId = node.backendNodeId;
      }
      const defaultRoot = AXNode.createTree(nodes);
      let needle = defaultRoot;
      if (backendNodeId) {
        needle = defaultRoot.find(node => node._payload.backendDOMNodeId === backendNodeId);
        if (!needle)
          return null;
      }
      if (!interestingOnly)
        return serializeTree(needle)[0];
  
      /** @type {!Set<!AXNode>} */
      const interestingNodes = new Set();
      collectInterestingNodes(interestingNodes, defaultRoot, false);
      if (!interestingNodes.has(needle))
        return null;
      return serializeTree(needle, interestingNodes)[0];
    }
  }
  
  /**
   * @param {!Set<!AXNode>} collection
   * @param {!AXNode} node
   * @param {boolean} insideControl
   */
  function collectInterestingNodes(collection, node, insideControl) {
    if (node.isInteresting(insideControl))
      collection.add(node);
    if (node.isLeafNode())
      return;
    insideControl = insideControl || node.isControl();
    for (const child of node._children)
      collectInterestingNodes(collection, child, insideControl);
  }
  
  /**
   * @param {!AXNode} node
   * @param {!Set<!AXNode>=} whitelistedNodes
   * @return {!Array<!SerializedAXNode>}
   */
  function serializeTree(node, whitelistedNodes) {
    /** @type {!Array<!SerializedAXNode>} */
    const children = [];
    for (const child of node._children)
      children.push(...serializeTree(child, whitelistedNodes));
  
    if (whitelistedNodes && !whitelistedNodes.has(node))
      return children;
  
    const serializedNode = node.serialize();
    if (children.length)
      serializedNode.children = children;
    return [serializedNode];
  }
  
  
  class AXNode {
    /**
     * @param {!Protocol.Accessibility.AXNode} payload
     */
    constructor(payload) {
      this._payload = payload;
  
      /** @type {!Array<!AXNode>} */
      this._children = [];
  
      this._richlyEditable = false;
      this._editable = false;
      this._focusable = false;
      this._expanded = false;
      this._hidden = false;
      this._name = this._payload.name ? this._payload.name.value : '';
      this._role = this._payload.role ? this._payload.role.value : 'Unknown';
      this._cachedHasFocusableChild;
  
      for (const property of this._payload.properties || []) {
        if (property.name === 'editable') {
          this._richlyEditable = property.value.value === 'richtext';
          this._editable = true;
        }
        if (property.name === 'focusable')
          this._focusable = property.value.value;
        if (property.name === 'expanded')
          this._expanded = property.value.value;
        if (property.name === 'hidden')
          this._hidden = property.value.value;
      }
    }
  
    /**
     * @return {boolean}
     */
    _isPlainTextField() {
      if (this._richlyEditable)
        return false;
      if (this._editable)
        return true;
      return this._role === 'textbox' || this._role === 'ComboBox' || this._role === 'searchbox';
    }
  
    /**
     * @return {boolean}
     */
    _isTextOnlyObject() {
      const role = this._role;
      return (role === 'LineBreak' || role === 'text' ||
              role === 'InlineTextBox');
    }
  
    /**
     * @return {boolean}
     */
    _hasFocusableChild() {
      if (this._cachedHasFocusableChild === undefined) {
        this._cachedHasFocusableChild = false;
        for (const child of this._children) {
          if (child._focusable || child._hasFocusableChild()) {
            this._cachedHasFocusableChild = true;
            break;
          }
        }
      }
      return this._cachedHasFocusableChild;
    }
  
    /**
     * @param {function(AXNode):boolean} predicate
     * @return {?AXNode}
     */
    find(predicate) {
      if (predicate(this))
        return this;
      for (const child of this._children) {
        const result = child.find(predicate);
        if (result)
          return result;
      }
      return null;
    }
  
    /**
     * @return {boolean}
     */
    isLeafNode() {
      if (!this._children.length)
        return true;
  
      // These types of objects may have children that we use as internal
      // implementation details, but we want to expose them as leaves to platform
      // accessibility APIs because screen readers might be confused if they find
      // any children.
      if (this._isPlainTextField() || this._isTextOnlyObject())
        return true;
  
      // Roles whose children are only presentational according to the ARIA and
      // HTML5 Specs should be hidden from screen readers.
      // (Note that whilst ARIA buttons can have only presentational children, HTML5
      // buttons are allowed to have content.)
      switch (this._role) {
        case 'doc-cover':
        case 'graphics-symbol':
        case 'img':
        case 'Meter':
        case 'scrollbar':
        case 'slider':
        case 'separator':
        case 'progressbar':
          return true;
        default:
          break;
      }
  
      // Here and below: Android heuristics
      if (this._hasFocusableChild())
        return false;
      if (this._focusable && this._name)
        return true;
      if (this._role === 'heading' && this._name)
        return true;
      return false;
    }
  
    /**
     * @return {boolean}
     */
    isControl() {
      switch (this._role) {
        case 'button':
        case 'checkbox':
        case 'ColorWell':
        case 'combobox':
        case 'DisclosureTriangle':
        case 'listbox':
        case 'menu':
        case 'menubar':
        case 'menuitem':
        case 'menuitemcheckbox':
        case 'menuitemradio':
        case 'radio':
        case 'scrollbar':
        case 'searchbox':
        case 'slider':
        case 'spinbutton':
        case 'switch':
        case 'tab':
        case 'textbox':
        case 'tree':
          return true;
        default:
          return false;
      }
    }
  
    /**
     * @param {boolean} insideControl
     * @return {boolean}
     */
    isInteresting(insideControl) {
      const role = this._role;
      if (role === 'Ignored' || this._hidden)
        return false;
  
      if (this._focusable || this._richlyEditable)
        return true;
  
      // If it's not focusable but has a control role, then it's interesting.
      if (this.isControl())
        return true;
  
      // A non focusable child of a control is not interesting
      if (insideControl)
        return false;
  
      return this.isLeafNode() && !!this._name;
    }
  
    /**
     * @return {!SerializedAXNode}
     */
    serialize() {
      /** @type {!Map<string, number|string|boolean>} */
      const properties = new Map();
      for (const property of this._payload.properties || [])
        properties.set(property.name.toLowerCase(), property.value.value);
      if (this._payload.name)
        properties.set('name', this._payload.name.value);
      if (this._payload.value)
        properties.set('value', this._payload.value.value);
      if (this._payload.description)
        properties.set('description', this._payload.description.value);
  
      /** @type {SerializedAXNode} */
      const node = {
        role: this._role
      };
  
      /** @type {!Array<keyof SerializedAXNode>} */
      const userStringProperties = [
        'name',
        'value',
        'description',
        'keyshortcuts',
        'roledescription',
        'valuetext',
      ];
      for (const userStringProperty of userStringProperties) {
        if (!properties.has(userStringProperty))
          continue;
        node[userStringProperty] = properties.get(userStringProperty);
      }
  
      /** @type {!Array<keyof SerializedAXNode>} */
      const booleanProperties = [
        'disabled',
        'expanded',
        'focused',
        'modal',
        'multiline',
        'multiselectable',
        'readonly',
        'required',
        'selected',
      ];
      for (const booleanProperty of booleanProperties) {
        // WebArea's treat focus differently than other nodes. They report whether their frame  has focus,
        // not whether focus is specifically on the root node.
        if (booleanProperty === 'focused' && this._role === 'WebArea')
          continue;
        const value = properties.get(booleanProperty);
        if (!value)
          continue;
        node[booleanProperty] = value;
      }
  
      /** @type {!Array<keyof SerializedAXNode>} */
      const tristateProperties = [
        'checked',
        'pressed',
      ];
      for (const tristateProperty of tristateProperties) {
        if (!properties.has(tristateProperty))
          continue;
        const value = properties.get(tristateProperty);
        node[tristateProperty] = value === 'mixed' ? 'mixed' : value === 'true' ? true : false;
      }
      /** @type {!Array<keyof SerializedAXNode>} */
      const numericalProperties = [
        'level',
        'valuemax',
        'valuemin',
      ];
      for (const numericalProperty of numericalProperties) {
        if (!properties.has(numericalProperty))
          continue;
        node[numericalProperty] = properties.get(numericalProperty);
      }
      /** @type {!Array<keyof SerializedAXNode>} */
      const tokenProperties = [
        'autocomplete',
        'haspopup',
        'invalid',
        'orientation',
      ];
      for (const tokenProperty of tokenProperties) {
        const value = properties.get(tokenProperty);
        if (!value || value === 'false')
          continue;
        node[tokenProperty] = value;
      }
      return node;
    }
  
    /**
     * @param {!Array<!Protocol.Accessibility.AXNode>} payloads
     * @return {!AXNode}
     */
    static createTree(payloads) {
      /** @type {!Map<string, !AXNode>} */
      const nodeById = new Map();
      for (const payload of payloads)
        nodeById.set(payload.nodeId, new AXNode(payload));
      for (const node of nodeById.values()) {
        for (const childId of node._payload.childIds || [])
          node._children.push(nodeById.get(childId));
      }
      return nodeById.values().next().value;
    }
  }
  
  module.exports = {Accessibility};
  
  },{}],42:[function(require,module,exports){
  /**
   * Copyright 2017 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  
  const { helper, assert } = require('./helper');
  const {Target} = require('./Target');
  const EventEmitter = require('events');
  const {TaskQueue} = require('./TaskQueue');
  const {Events} = require('./Events');
  
  class Browser extends EventEmitter {
    /**
     * @param {!Puppeteer.Connection} connection
     * @param {!Array<string>} contextIds
     * @param {boolean} ignoreHTTPSErrors
     * @param {?Puppeteer.Viewport} defaultViewport
     * @param {?Puppeteer.ChildProcess} process
     * @param {function()=} closeCallback
     */
    static async create(connection, contextIds, ignoreHTTPSErrors, defaultViewport, process, closeCallback) {
      const browser = new Browser(connection, contextIds, ignoreHTTPSErrors, defaultViewport, process, closeCallback);
      await connection.send('Target.setDiscoverTargets', {discover: true});
      return browser;
    }
  
    /**
     * @param {!Puppeteer.Connection} connection
     * @param {!Array<string>} contextIds
     * @param {boolean} ignoreHTTPSErrors
     * @param {?Puppeteer.Viewport} defaultViewport
     * @param {?Puppeteer.ChildProcess} process
     * @param {(function():Promise)=} closeCallback
     */
    constructor(connection, contextIds, ignoreHTTPSErrors, defaultViewport, process, closeCallback) {
      super();
      this._ignoreHTTPSErrors = ignoreHTTPSErrors;
      this._defaultViewport = defaultViewport;
      this._process = process;
      this._screenshotTaskQueue = new TaskQueue();
      this._connection = connection;
      this._closeCallback = closeCallback || new Function();
  
      this._defaultContext = new BrowserContext(this._connection, this, null);
      /** @type {Map<string, BrowserContext>} */
      this._contexts = new Map();
      for (const contextId of contextIds)
        this._contexts.set(contextId, new BrowserContext(this._connection, this, contextId));
  
      /** @type {Map<string, Target>} */
      this._targets = new Map();
      this._connection.on(Events.Connection.Disconnected, () => this.emit(Events.Browser.Disconnected));
      this._connection.on('Target.targetCreated', this._targetCreated.bind(this));
      this._connection.on('Target.targetDestroyed', this._targetDestroyed.bind(this));
      this._connection.on('Target.targetInfoChanged', this._targetInfoChanged.bind(this));
    }
  
    /**
     * @return {?Puppeteer.ChildProcess}
     */
    process() {
      return this._process;
    }
  
    /**
     * @return {!Promise<!BrowserContext>}
     */
    async createIncognitoBrowserContext() {
      const {browserContextId} = await this._connection.send('Target.createBrowserContext');
      const context = new BrowserContext(this._connection, this, browserContextId);
      this._contexts.set(browserContextId, context);
      return context;
    }
  
    /**
     * @return {!Array<!BrowserContext>}
     */
    browserContexts() {
      return [this._defaultContext, ...Array.from(this._contexts.values())];
    }
  
    /**
     * @return {!BrowserContext}
     */
    defaultBrowserContext() {
      return this._defaultContext;
    }
  
    /**
     * @param {?string} contextId
     */
    async _disposeContext(contextId) {
      await this._connection.send('Target.disposeBrowserContext', {browserContextId: contextId || undefined});
      this._contexts.delete(contextId);
    }
  
    /**
     * @param {!Protocol.Target.targetCreatedPayload} event
     */
    async _targetCreated(event) {
      const targetInfo = event.targetInfo;
      const {browserContextId} = targetInfo;
      const context = (browserContextId && this._contexts.has(browserContextId)) ? this._contexts.get(browserContextId) : this._defaultContext;
  
      const target = new Target(targetInfo, context, () => this._connection.createSession(targetInfo), this._ignoreHTTPSErrors, this._defaultViewport, this._screenshotTaskQueue);
      assert(!this._targets.has(event.targetInfo.targetId), 'Target should not exist before targetCreated');
      this._targets.set(event.targetInfo.targetId, target);
  
      if (await target._initializedPromise) {
        this.emit(Events.Browser.TargetCreated, target);
        context.emit(Events.BrowserContext.TargetCreated, target);
      }
    }
  
    /**
     * @param {{targetId: string}} event
     */
    async _targetDestroyed(event) {
      const target = this._targets.get(event.targetId);
      target._initializedCallback(false);
      this._targets.delete(event.targetId);
      target._closedCallback();
      if (await target._initializedPromise) {
        this.emit(Events.Browser.TargetDestroyed, target);
        target.browserContext().emit(Events.BrowserContext.TargetDestroyed, target);
      }
    }
  
    /**
     * @param {!Protocol.Target.targetInfoChangedPayload} event
     */
    _targetInfoChanged(event) {
      const target = this._targets.get(event.targetInfo.targetId);
      assert(target, 'target should exist before targetInfoChanged');
      const previousURL = target.url();
      const wasInitialized = target._isInitialized;
      target._targetInfoChanged(event.targetInfo);
      if (wasInitialized && previousURL !== target.url()) {
        this.emit(Events.Browser.TargetChanged, target);
        target.browserContext().emit(Events.BrowserContext.TargetChanged, target);
      }
    }
  
    /**
     * @return {string}
     */
    wsEndpoint() {
      return this._connection.url();
    }
  
    /**
     * @return {!Promise<!Puppeteer.Page>}
     */
    async newPage() {
      return this._defaultContext.newPage();
    }
  
    /**
     * @param {?string} contextId
     * @return {!Promise<!Puppeteer.Page>}
     */
    async _createPageInContext(contextId) {
      const {targetId} = await this._connection.send('Target.createTarget', {url: 'about:blank', browserContextId: contextId || undefined});
      const target = await this._targets.get(targetId);
      assert(await target._initializedPromise, 'Failed to create target for page');
      const page = await target.page();
      return page;
    }
  
    /**
     * @return {!Array<!Target>}
     */
    targets() {
      return Array.from(this._targets.values()).filter(target => target._isInitialized);
    }
  
    /**
     * @return {!Target}
     */
    target() {
      return this.targets().find(target => target.type() === 'browser');
    }
  
    /**
     * @param {function(!Target):boolean} predicate
     * @param {{timeout?: number}=} options
     * @return {!Promise<!Target>}
     */
    async waitForTarget(predicate, options = {}) {
      const {
        timeout = 30000
      } = options;
      const existingTarget = this.targets().find(predicate);
      if (existingTarget)
        return existingTarget;
      let resolve;
      const targetPromise = new Promise(x => resolve = x);
      this.on(Events.Browser.TargetCreated, check);
      this.on(Events.Browser.TargetChanged, check);
      try {
        if (!timeout)
          return await targetPromise;
        return await helper.waitWithTimeout(targetPromise, 'target', timeout);
      } finally {
        this.removeListener(Events.Browser.TargetCreated, check);
        this.removeListener(Events.Browser.TargetChanged, check);
      }
  
      /**
       * @param {!Target} target
       */
      function check(target) {
        if (predicate(target))
          resolve(target);
      }
    }
  
    /**
     * @return {!Promise<!Array<!Puppeteer.Page>>}
     */
    async pages() {
      const contextPages = await Promise.all(this.browserContexts().map(context => context.pages()));
      // Flatten array.
      return contextPages.reduce((acc, x) => acc.concat(x), []);
    }
  
    /**
     * @return {!Promise<string>}
     */
    async version() {
      const version = await this._getVersion();
      return version.product;
    }
  
    /**
     * @return {!Promise<string>}
     */
    async userAgent() {
      const version = await this._getVersion();
      return version.userAgent;
    }
  
    async close() {
      await this._closeCallback.call(null);
      this.disconnect();
    }
  
    disconnect() {
      this._connection.dispose();
    }
  
    /**
     * @return {boolean}
     */
    isConnected() {
      return !this._connection._closed;
    }
  
    /**
     * @return {!Promise<!Object>}
     */
    _getVersion() {
      return this._connection.send('Browser.getVersion');
    }
  }
  
  class BrowserContext extends EventEmitter {
    /**
     * @param {!Puppeteer.Connection} connection
     * @param {!Browser} browser
     * @param {?string} contextId
     */
    constructor(connection, browser, contextId) {
      super();
      this._connection = connection;
      this._browser = browser;
      this._id = contextId;
    }
  
    /**
     * @return {!Array<!Target>} target
     */
    targets() {
      return this._browser.targets().filter(target => target.browserContext() === this);
    }
  
    /**
     * @param {function(!Target):boolean} predicate
     * @param {{timeout?: number}=} options
     * @return {!Promise<!Target>}
     */
    waitForTarget(predicate, options) {
      return this._browser.waitForTarget(target => target.browserContext() === this && predicate(target), options);
    }
  
    /**
     * @return {!Promise<!Array<!Puppeteer.Page>>}
     */
    async pages() {
      const pages = await Promise.all(
          this.targets()
              .filter(target => target.type() === 'page')
              .map(target => target.page())
      );
      return pages.filter(page => !!page);
    }
  
    /**
     * @return {boolean}
     */
    isIncognito() {
      return !!this._id;
    }
  
    /**
     * @param {string} origin
     * @param {!Array<string>} permissions
     */
    async overridePermissions(origin, permissions) {
      const webPermissionToProtocol = new Map([
        ['geolocation', 'geolocation'],
        ['midi', 'midi'],
        ['notifications', 'notifications'],
        ['push', 'push'],
        ['camera', 'videoCapture'],
        ['microphone', 'audioCapture'],
        ['background-sync', 'backgroundSync'],
        ['ambient-light-sensor', 'sensors'],
        ['accelerometer', 'sensors'],
        ['gyroscope', 'sensors'],
        ['magnetometer', 'sensors'],
        ['accessibility-events', 'accessibilityEvents'],
        ['clipboard-read', 'clipboardRead'],
        ['clipboard-write', 'clipboardWrite'],
        ['payment-handler', 'paymentHandler'],
        // chrome-specific permissions we have.
        ['midi-sysex', 'midiSysex'],
      ]);
      permissions = permissions.map(permission => {
        const protocolPermission = webPermissionToProtocol.get(permission);
        if (!protocolPermission)
          throw new Error('Unknown permission: ' + permission);
        return protocolPermission;
      });
      await this._connection.send('Browser.grantPermissions', {origin, browserContextId: this._id || undefined, permissions});
    }
  
    async clearPermissionOverrides() {
      await this._connection.send('Browser.resetPermissions', {browserContextId: this._id || undefined});
    }
  
    /**
     * @return {!Promise<!Puppeteer.Page>}
     */
    newPage() {
      return this._browser._createPageInContext(this._id);
    }
  
    /**
     * @return {!Browser}
     */
    browser() {
      return this._browser;
    }
  
    async close() {
      assert(this._id, 'Non-incognito profiles cannot be closed!');
      await this._browser._disposeContext(this._id);
    }
  }
  
  module.exports = {Browser, BrowserContext};
  
  },{"./Events":50,"./Target":61,"./TaskQueue":62,"./helper":69,"events":5}],43:[function(require,module,exports){
  /**
   * Copyright 2017 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  const {assert} = require('./helper');
  const {Events} = require('./Events');
  const debugProtocol = require('debug')('puppeteer:protocol');
  const EventEmitter = require('events');
  
  class Connection extends EventEmitter {
    /**
     * @param {string} url
     * @param {!Puppeteer.ConnectionTransport} transport
     * @param {number=} delay
     */
    constructor(url, transport, delay = 0) {
      super();
      this._url = url;
      this._lastId = 0;
      /** @type {!Map<number, {resolve: function, reject: function, error: !Error, method: string}>}*/
      this._callbacks = new Map();
      this._delay = delay;
  
      this._transport = transport;
      this._transport.onmessage = this._onMessage.bind(this);
      this._transport.onclose = this._onClose.bind(this);
      /** @type {!Map<string, !CDPSession>}*/
      this._sessions = new Map();
      this._closed = false;
    }
  
    /**
     * @param {!CDPSession} session
     * @return {!Connection}
     */
    static fromSession(session) {
      return session._connection;
    }
  
    /**
     * @param {string} sessionId
     * @return {?CDPSession}
     */
    session(sessionId) {
      return this._sessions.get(sessionId) || null;
    }
  
    /**
     * @return {string}
     */
    url() {
      return this._url;
    }
  
    /**
     * @param {string} method
     * @param {!Object=} params
     * @return {!Promise<?Object>}
     */
    send(method, params = {}) {
      const id = this._rawSend({method, params});
      return new Promise((resolve, reject) => {
        this._callbacks.set(id, {resolve, reject, error: new Error(), method});
      });
    }
  
    /**
     * @param {*} message
     * @return {number}
     */
    _rawSend(message) {
      const id = ++this._lastId;
      message = JSON.stringify(Object.assign({}, message, {id}));
      debugProtocol('SEND ► ' + message);
      this._transport.send(message);
      return id;
    }
  
    /**
     * @param {string} message
     */
    async _onMessage(message) {
      if (this._delay)
        await new Promise(f => setTimeout(f, this._delay));
      debugProtocol('◀ RECV ' + message);
      const object = JSON.parse(message);
      if (object.method === 'Target.attachedToTarget') {
        const sessionId = object.params.sessionId;
        const session = new CDPSession(this, object.params.targetInfo.type, sessionId);
        this._sessions.set(sessionId, session);
      } else if (object.method === 'Target.detachedFromTarget') {
        const session = this._sessions.get(object.params.sessionId);
        if (session) {
          session._onClosed();
          this._sessions.delete(object.params.sessionId);
        }
      }
      if (object.sessionId) {
        const session = this._sessions.get(object.sessionId);
        if (session)
          session._onMessage(object);
      } else if (object.id) {
        const callback = this._callbacks.get(object.id);
        // Callbacks could be all rejected if someone has called `.dispose()`.
        if (callback) {
          this._callbacks.delete(object.id);
          if (object.error)
            callback.reject(createProtocolError(callback.error, callback.method, object));
          else
            callback.resolve(object.result);
        }
      } else {
        this.emit(object.method, object.params);
      }
    }
  
    _onClose() {
      if (this._closed)
        return;
      this._closed = true;
      this._transport.onmessage = null;
      this._transport.onclose = null;
      for (const callback of this._callbacks.values())
        callback.reject(rewriteError(callback.error, `Protocol error (${callback.method}): Target closed.`));
      this._callbacks.clear();
      for (const session of this._sessions.values())
        session._onClosed();
      this._sessions.clear();
      this.emit(Events.Connection.Disconnected);
    }
  
    dispose() {
      this._onClose();
      this._transport.close();
    }
  
    /**
     * @param {Protocol.Target.TargetInfo} targetInfo
     * @return {!Promise<!CDPSession>}
     */
    async createSession(targetInfo) {
      const {sessionId} = await this.send('Target.attachToTarget', {targetId: targetInfo.targetId, flatten: true});
      return this._sessions.get(sessionId);
    }
  }
  
  class CDPSession extends EventEmitter {
    /**
     * @param {!Connection} connection
     * @param {string} targetType
     * @param {string} sessionId
     */
    constructor(connection, targetType, sessionId) {
      super();
      /** @type {!Map<number, {resolve: function, reject: function, error: !Error, method: string}>}*/
      this._callbacks = new Map();
      this._connection = connection;
      this._targetType = targetType;
      this._sessionId = sessionId;
    }
  
    /**
     * @param {string} method
     * @param {!Object=} params
     * @return {!Promise<?Object>}
     */
    send(method, params = {}) {
      if (!this._connection)
        return Promise.reject(new Error(`Protocol error (${method}): Session closed. Most likely the ${this._targetType} has been closed.`));
      const id = this._connection._rawSend({sessionId: this._sessionId, method, params});
      return new Promise((resolve, reject) => {
        this._callbacks.set(id, {resolve, reject, error: new Error(), method});
      });
    }
  
    /**
     * @param {{id?: number, method: string, params: Object, error: {message: string, data: any}, result?: *}} object
     */
    _onMessage(object) {
      if (object.id && this._callbacks.has(object.id)) {
        const callback = this._callbacks.get(object.id);
        this._callbacks.delete(object.id);
        if (object.error)
          callback.reject(createProtocolError(callback.error, callback.method, object));
        else
          callback.resolve(object.result);
      } else {
        assert(!object.id);
        this.emit(object.method, object.params);
      }
    }
  
    async detach() {
      if (!this._connection)
        throw new Error(`Session already detached. Most likely the ${this._targetType} has been closed.`);
      await this._connection.send('Target.detachFromTarget',  {sessionId: this._sessionId});
    }
  
    _onClosed() {
      for (const callback of this._callbacks.values())
        callback.reject(rewriteError(callback.error, `Protocol error (${callback.method}): Target closed.`));
      this._callbacks.clear();
      this._connection = null;
      this.emit(Events.CDPSession.Disconnected);
    }
  }
  
  /**
   * @param {!Error} error
   * @param {string} method
   * @param {{error: {message: string, data: any}}} object
   * @return {!Error}
   */
  function createProtocolError(error, method, object) {
    let message = `Protocol error (${method}): ${object.error.message}`;
    if ('data' in object.error)
      message += ` ${object.error.data}`;
    return rewriteError(error, message);
  }
  
  /**
   * @param {!Error} error
   * @param {string} message
   * @return {!Error}
   */
  function rewriteError(error, message) {
    error.message = message;
    return error;
  }
  
  module.exports = {Connection, CDPSession};
  
  },{"./Events":50,"./helper":69,"debug":70,"events":5}],44:[function(require,module,exports){
  /**
   * Copyright 2017 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  
  const {helper, debugError, assert} = require('./helper');
  
  const {EVALUATION_SCRIPT_URL} = require('./ExecutionContext');
  
  /**
   * @typedef {Object} CoverageEntry
   * @property {string} url
   * @property {string} text
   * @property {!Array<!{start: number, end: number}>} ranges
   */
  
  class Coverage {
    /**
     * @param {!Puppeteer.CDPSession} client
     */
    constructor(client) {
      this._jsCoverage = new JSCoverage(client);
      this._cssCoverage = new CSSCoverage(client);
    }
  
    /**
     * @param {!{resetOnNavigation?: boolean, reportAnonymousScripts?: boolean}} options
     */
    async startJSCoverage(options) {
      return await this._jsCoverage.start(options);
    }
  
    /**
     * @return {!Promise<!Array<!CoverageEntry>>}
     */
    async stopJSCoverage() {
      return await this._jsCoverage.stop();
    }
  
    /**
     * @param {{resetOnNavigation?: boolean}=} options
     */
    async startCSSCoverage(options) {
      return await this._cssCoverage.start(options);
    }
  
    /**
     * @return {!Promise<!Array<!CoverageEntry>>}
     */
    async stopCSSCoverage() {
      return await this._cssCoverage.stop();
    }
  }
  
  module.exports = {Coverage};
  
  class JSCoverage {
    /**
     * @param {!Puppeteer.CDPSession} client
     */
    constructor(client) {
      this._client = client;
      this._enabled = false;
      this._scriptURLs = new Map();
      this._scriptSources = new Map();
      this._eventListeners = [];
      this._resetOnNavigation = false;
    }
  
    /**
     * @param {!{resetOnNavigation?: boolean, reportAnonymousScripts?: boolean}} options
     */
    async start(options = {}) {
      assert(!this._enabled, 'JSCoverage is already enabled');
      const {
        resetOnNavigation = true,
        reportAnonymousScripts = false
      } = options;
      this._resetOnNavigation = resetOnNavigation;
      this._reportAnonymousScripts = reportAnonymousScripts;
      this._enabled = true;
      this._scriptURLs.clear();
      this._scriptSources.clear();
      this._eventListeners = [
        helper.addEventListener(this._client, 'Debugger.scriptParsed', this._onScriptParsed.bind(this)),
        helper.addEventListener(this._client, 'Runtime.executionContextsCleared', this._onExecutionContextsCleared.bind(this)),
      ];
      await Promise.all([
        this._client.send('Profiler.enable'),
        this._client.send('Profiler.startPreciseCoverage', {callCount: false, detailed: true}),
        this._client.send('Debugger.enable'),
        this._client.send('Debugger.setSkipAllPauses', {skip: true})
      ]);
    }
  
    _onExecutionContextsCleared() {
      if (!this._resetOnNavigation)
        return;
      this._scriptURLs.clear();
      this._scriptSources.clear();
    }
  
    /**
     * @param {!Protocol.Debugger.scriptParsedPayload} event
     */
    async _onScriptParsed(event) {
      // Ignore puppeteer-injected scripts
      if (event.url === EVALUATION_SCRIPT_URL)
        return;
      // Ignore other anonymous scripts unless the reportAnonymousScripts option is true.
      if (!event.url && !this._reportAnonymousScripts)
        return;
      try {
        const response = await this._client.send('Debugger.getScriptSource', {scriptId: event.scriptId});
        this._scriptURLs.set(event.scriptId, event.url);
        this._scriptSources.set(event.scriptId, response.scriptSource);
      } catch (e) {
        // This might happen if the page has already navigated away.
        debugError(e);
      }
    }
  
    /**
     * @return {!Promise<!Array<!CoverageEntry>>}
     */
    async stop() {
      assert(this._enabled, 'JSCoverage is not enabled');
      this._enabled = false;
      const [profileResponse] = await Promise.all([
        this._client.send('Profiler.takePreciseCoverage'),
        this._client.send('Profiler.stopPreciseCoverage'),
        this._client.send('Profiler.disable'),
        this._client.send('Debugger.disable'),
      ]);
      helper.removeEventListeners(this._eventListeners);
  
      const coverage = [];
      for (const entry of profileResponse.result) {
        let url = this._scriptURLs.get(entry.scriptId);
        if (!url && this._reportAnonymousScripts)
          url = 'debugger://VM' + entry.scriptId;
        const text = this._scriptSources.get(entry.scriptId);
        if (text === undefined || url === undefined)
          continue;
        const flattenRanges = [];
        for (const func of entry.functions)
          flattenRanges.push(...func.ranges);
        const ranges = convertToDisjointRanges(flattenRanges);
        coverage.push({url, ranges, text});
      }
      return coverage;
    }
  }
  
  class CSSCoverage {
    /**
     * @param {!Puppeteer.CDPSession} client
     */
    constructor(client) {
      this._client = client;
      this._enabled = false;
      this._stylesheetURLs = new Map();
      this._stylesheetSources = new Map();
      this._eventListeners = [];
      this._resetOnNavigation = false;
    }
  
    /**
     * @param {{resetOnNavigation?: boolean}=} options
     */
    async start(options = {}) {
      assert(!this._enabled, 'CSSCoverage is already enabled');
      const {resetOnNavigation = true} = options;
      this._resetOnNavigation = resetOnNavigation;
      this._enabled = true;
      this._stylesheetURLs.clear();
      this._stylesheetSources.clear();
      this._eventListeners = [
        helper.addEventListener(this._client, 'CSS.styleSheetAdded', this._onStyleSheet.bind(this)),
        helper.addEventListener(this._client, 'Runtime.executionContextsCleared', this._onExecutionContextsCleared.bind(this)),
      ];
      await Promise.all([
        this._client.send('DOM.enable'),
        this._client.send('CSS.enable'),
        this._client.send('CSS.startRuleUsageTracking'),
      ]);
    }
  
    _onExecutionContextsCleared() {
      if (!this._resetOnNavigation)
        return;
      this._stylesheetURLs.clear();
      this._stylesheetSources.clear();
    }
  
    /**
     * @param {!Protocol.CSS.styleSheetAddedPayload} event
     */
    async _onStyleSheet(event) {
      const header = event.header;
      // Ignore anonymous scripts
      if (!header.sourceURL)
        return;
      try {
        const response = await this._client.send('CSS.getStyleSheetText', {styleSheetId: header.styleSheetId});
        this._stylesheetURLs.set(header.styleSheetId, header.sourceURL);
        this._stylesheetSources.set(header.styleSheetId, response.text);
      } catch (e) {
        // This might happen if the page has already navigated away.
        debugError(e);
      }
    }
  
    /**
     * @return {!Promise<!Array<!CoverageEntry>>}
     */
    async stop() {
      assert(this._enabled, 'CSSCoverage is not enabled');
      this._enabled = false;
      const ruleTrackingResponse = await this._client.send('CSS.stopRuleUsageTracking');
      await Promise.all([
        this._client.send('CSS.disable'),
        this._client.send('DOM.disable'),
      ]);
      helper.removeEventListeners(this._eventListeners);
  
      // aggregate by styleSheetId
      const styleSheetIdToCoverage = new Map();
      for (const entry of ruleTrackingResponse.ruleUsage) {
        let ranges = styleSheetIdToCoverage.get(entry.styleSheetId);
        if (!ranges) {
          ranges = [];
          styleSheetIdToCoverage.set(entry.styleSheetId, ranges);
        }
        ranges.push({
          startOffset: entry.startOffset,
          endOffset: entry.endOffset,
          count: entry.used ? 1 : 0,
        });
      }
  
      const coverage = [];
      for (const styleSheetId of this._stylesheetURLs.keys()) {
        const url = this._stylesheetURLs.get(styleSheetId);
        const text = this._stylesheetSources.get(styleSheetId);
        const ranges = convertToDisjointRanges(styleSheetIdToCoverage.get(styleSheetId) || []);
        coverage.push({url, ranges, text});
      }
  
      return coverage;
    }
  }
  
  /**
   * @param {!Array<!{startOffset:number, endOffset:number, count:number}>} nestedRanges
   * @return {!Array<!{start:number, end:number}>}
   */
  function convertToDisjointRanges(nestedRanges) {
    const points = [];
    for (const range of nestedRanges) {
      points.push({ offset: range.startOffset, type: 0, range });
      points.push({ offset: range.endOffset, type: 1, range });
    }
    // Sort points to form a valid parenthesis sequence.
    points.sort((a, b) => {
      // Sort with increasing offsets.
      if (a.offset !== b.offset)
        return a.offset - b.offset;
      // All "end" points should go before "start" points.
      if (a.type !== b.type)
        return b.type - a.type;
      const aLength = a.range.endOffset - a.range.startOffset;
      const bLength = b.range.endOffset - b.range.startOffset;
      // For two "start" points, the one with longer range goes first.
      if (a.type === 0)
        return bLength - aLength;
      // For two "end" points, the one with shorter range goes first.
      return aLength - bLength;
    });
  
    const hitCountStack = [];
    const results = [];
    let lastOffset = 0;
    // Run scanning line to intersect all ranges.
    for (const point of points) {
      if (hitCountStack.length && lastOffset < point.offset && hitCountStack[hitCountStack.length - 1] > 0) {
        const lastResult = results.length ? results[results.length - 1] : null;
        if (lastResult && lastResult.end === lastOffset)
          lastResult.end = point.offset;
        else
          results.push({start: lastOffset, end: point.offset});
      }
      lastOffset = point.offset;
      if (point.type === 0)
        hitCountStack.push(point.range.count);
      else
        hitCountStack.pop();
    }
    // Filter out empty ranges.
    return results.filter(range => range.end - range.start > 1);
  }
  
  
  },{"./ExecutionContext":51,"./helper":69}],45:[function(require,module,exports){
  /**
   * Copyright 2019 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  
  const fs = require('fs');
  const {helper, assert} = require('./helper');
  const {LifecycleWatcher} = require('./LifecycleWatcher');
  const {TimeoutError} = require('./Errors');
  const readFileAsync = helper.promisify(fs.readFile);
  
  /**
   * @unrestricted
   */
  class DOMWorld {
    /**
     * @param {!Puppeteer.FrameManager} frameManager
     * @param {!Puppeteer.Frame} frame
     * @param {!Puppeteer.TimeoutSettings} timeoutSettings
     */
    constructor(frameManager, frame, timeoutSettings) {
      this._frameManager = frameManager;
      this._frame = frame;
      this._timeoutSettings = timeoutSettings;
  
      /** @type {?Promise<!Puppeteer.ElementHandle>} */
      this._documentPromise = null;
      /** @type {!Promise<!Puppeteer.ExecutionContext>} */
      this._contextPromise;
      this._contextResolveCallback = null;
      this._setContext(null);
  
      /** @type {!Set<!WaitTask>} */
      this._waitTasks = new Set();
      this._detached = false;
    }
  
    /**
     * @return {!Puppeteer.Frame}
     */
    frame() {
      return this._frame;
    }
  
    /**
     * @param {?Puppeteer.ExecutionContext} context
     */
    _setContext(context) {
      if (context) {
        this._contextResolveCallback.call(null, context);
        this._contextResolveCallback = null;
        for (const waitTask of this._waitTasks)
          waitTask.rerun();
      } else {
        this._documentPromise = null;
        this._contextPromise = new Promise(fulfill => {
          this._contextResolveCallback = fulfill;
        });
      }
    }
  
    /**
     * @return {boolean}
     */
    _hasContext() {
      return !this._contextResolveCallback;
    }
  
    _detach() {
      this._detached = true;
      for (const waitTask of this._waitTasks)
        waitTask.terminate(new Error('waitForFunction failed: frame got detached.'));
    }
  
    /**
     * @return {!Promise<!Puppeteer.ExecutionContext>}
     */
    executionContext() {
      if (this._detached)
        throw new Error(`Execution Context is not available in detached frame "${this._frame.url()}" (are you trying to evaluate?)`);
      return this._contextPromise;
    }
  
    /**
     * @param {Function|string} pageFunction
     * @param {!Array<*>} args
     * @return {!Promise<!Puppeteer.JSHandle>}
     */
    async evaluateHandle(pageFunction, ...args) {
      const context = await this.executionContext();
      return context.evaluateHandle(pageFunction, ...args);
    }
  
    /**
     * @param {Function|string} pageFunction
     * @param {!Array<*>} args
     * @return {!Promise<*>}
     */
    async evaluate(pageFunction, ...args) {
      const context = await this.executionContext();
      return context.evaluate(pageFunction, ...args);
    }
  
    /**
     * @param {string} selector
     * @return {!Promise<?Puppeteer.ElementHandle>}
     */
    async $(selector) {
      const document = await this._document();
      const value = await document.$(selector);
      return value;
    }
  
    /**
     * @return {!Promise<!Puppeteer.ElementHandle>}
     */
    async _document() {
      if (this._documentPromise)
        return this._documentPromise;
      this._documentPromise = this.executionContext().then(async context => {
        const document = await context.evaluateHandle('document');
        return document.asElement();
      });
      return this._documentPromise;
    }
  
    /**
     * @param {string} expression
     * @return {!Promise<!Array<!Puppeteer.ElementHandle>>}
     */
    async $x(expression) {
      const document = await this._document();
      const value = await document.$x(expression);
      return value;
    }
  
    /**
     * @param {string} selector
     * @param {Function|string} pageFunction
     * @param {!Array<*>} args
     * @return {!Promise<(!Object|undefined)>}
     */
    async $eval(selector, pageFunction, ...args) {
      const document = await this._document();
      return document.$eval(selector, pageFunction, ...args);
    }
  
    /**
     * @param {string} selector
     * @param {Function|string} pageFunction
     * @param {!Array<*>} args
     * @return {!Promise<(!Object|undefined)>}
     */
    async $$eval(selector, pageFunction, ...args) {
      const document = await this._document();
      const value = await document.$$eval(selector, pageFunction, ...args);
      return value;
    }
  
    /**
     * @param {string} selector
     * @return {!Promise<!Array<!Puppeteer.ElementHandle>>}
     */
    async $$(selector) {
      const document = await this._document();
      const value = await document.$$(selector);
      return value;
    }
  
    /**
     * @return {!Promise<String>}
     */
    async content() {
      return await this.evaluate(() => {
        let retVal = '';
        if (document.doctype)
          retVal = new XMLSerializer().serializeToString(document.doctype);
        if (document.documentElement)
          retVal += document.documentElement.outerHTML;
        return retVal;
      });
    }
  
    /**
     * @param {string} html
     * @param {!{timeout?: number, waitUntil?: string|!Array<string>}=} options
     */
    async setContent(html, options = {}) {
      const {
        waitUntil = ['load'],
        timeout = this._timeoutSettings.navigationTimeout(),
      } = options;
      // We rely upon the fact that document.open() will reset frame lifecycle with "init"
      // lifecycle event. @see https://crrev.com/608658
      await this.evaluate(html => {
        document.open();
        document.write(html);
        document.close();
      }, html);
      const watcher = new LifecycleWatcher(this._frameManager, this._frame, waitUntil, timeout);
      const error = await Promise.race([
        watcher.timeoutOrTerminationPromise(),
        watcher.lifecyclePromise(),
      ]);
      watcher.dispose();
      if (error)
        throw error;
    }
  
    /**
     * @param {!{url?: string, path?: string, content?: string, type?: string}} options
     * @return {!Promise<!Puppeteer.ElementHandle>}
     */
    async addScriptTag(options) {
      const {
        url = null,
        path = null,
        content = null,
        type = ''
      } = options;
      if (url !== null) {
        try {
          const context = await this.executionContext();
          return (await context.evaluateHandle(addScriptUrl, url, type)).asElement();
        } catch (error) {
          throw new Error(`Loading script from ${url} failed`);
        }
      }
  
      if (path !== null) {
        let contents = await readFileAsync(path, 'utf8');
        contents += '//# sourceURL=' + path.replace(/\n/g, '');
        const context = await this.executionContext();
        return (await context.evaluateHandle(addScriptContent, contents, type)).asElement();
      }
  
      if (content !== null) {
        const context = await this.executionContext();
        return (await context.evaluateHandle(addScriptContent, content, type)).asElement();
      }
  
      throw new Error('Provide an object with a `url`, `path` or `content` property');
  
      /**
       * @param {string} url
       * @param {string} type
       * @return {!Promise<!HTMLElement>}
       */
      async function addScriptUrl(url, type) {
        const script = document.createElement('script');
        script.src = url;
        if (type)
          script.type = type;
        const promise = new Promise((res, rej) => {
          script.onload = res;
          script.onerror = rej;
        });
        document.head.appendChild(script);
        await promise;
        return script;
      }
  
      /**
       * @param {string} content
       * @param {string} type
       * @return {!HTMLElement}
       */
      function addScriptContent(content, type = 'text/javascript') {
        const script = document.createElement('script');
        script.type = type;
        script.text = content;
        let error = null;
        script.onerror = e => error = e;
        document.head.appendChild(script);
        if (error)
          throw error;
        return script;
      }
    }
  
    /**
     * @param {!{url?: string, path?: string, content?: string}} options
     * @return {!Promise<!Puppeteer.ElementHandle>}
     */
    async addStyleTag(options) {
      const {
        url = null,
        path = null,
        content = null
      } = options;
      if (url !== null) {
        try {
          const context = await this.executionContext();
          return (await context.evaluateHandle(addStyleUrl, url)).asElement();
        } catch (error) {
          throw new Error(`Loading style from ${url} failed`);
        }
      }
  
      if (path !== null) {
        let contents = await readFileAsync(path, 'utf8');
        contents += '/*# sourceURL=' + path.replace(/\n/g, '') + '*/';
        const context = await this.executionContext();
        return (await context.evaluateHandle(addStyleContent, contents)).asElement();
      }
  
      if (content !== null) {
        const context = await this.executionContext();
        return (await context.evaluateHandle(addStyleContent, content)).asElement();
      }
  
      throw new Error('Provide an object with a `url`, `path` or `content` property');
  
      /**
       * @param {string} url
       * @return {!Promise<!HTMLElement>}
       */
      async function addStyleUrl(url) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        const promise = new Promise((res, rej) => {
          link.onload = res;
          link.onerror = rej;
        });
        document.head.appendChild(link);
        await promise;
        return link;
      }
  
      /**
       * @param {string} content
       * @return {!Promise<!HTMLElement>}
       */
      async function addStyleContent(content) {
        const style = document.createElement('style');
        style.type = 'text/css';
        style.appendChild(document.createTextNode(content));
        const promise = new Promise((res, rej) => {
          style.onload = res;
          style.onerror = rej;
        });
        document.head.appendChild(style);
        await promise;
        return style;
      }
    }
  
    /**
     * @param {string} selector
     * @param {!{delay?: number, button?: "left"|"right"|"middle", clickCount?: number}=} options
     */
    async click(selector, options) {
      const handle = await this.$(selector);
      assert(handle, 'No node found for selector: ' + selector);
      await handle.click(options);
      await handle.dispose();
    }
  
    /**
     * @param {string} selector
     */
    async focus(selector) {
      const handle = await this.$(selector);
      assert(handle, 'No node found for selector: ' + selector);
      await handle.focus();
      await handle.dispose();
    }
  
    /**
     * @param {string} selector
     */
    async hover(selector) {
      const handle = await this.$(selector);
      assert(handle, 'No node found for selector: ' + selector);
      await handle.hover();
      await handle.dispose();
    }
  
    /**
     * @param {string} selector
     * @param {!Array<string>} values
     * @return {!Promise<!Array<string>>}
     */
    async select(selector, ...values) {
      const handle = await this.$(selector);
      assert(handle, 'No node found for selector: ' + selector);
      const result = await handle.select(...values);
      await handle.dispose();
      return result;
    }
  
    /**
     * @param {string} selector
     */
    async tap(selector) {
      const handle = await this.$(selector);
      assert(handle, 'No node found for selector: ' + selector);
      await handle.tap();
      await handle.dispose();
    }
  
    /**
     * @param {string} selector
     * @param {string} text
     * @param {{delay: (number|undefined)}=} options
     */
    async type(selector, text, options) {
      const handle = await this.$(selector);
      assert(handle, 'No node found for selector: ' + selector);
      await handle.type(text, options);
      await handle.dispose();
    }
  
    /**
     * @param {string} selector
     * @param {!{visible?: boolean, hidden?: boolean, timeout?: number}=} options
     * @return {!Promise<?Puppeteer.ElementHandle>}
     */
    waitForSelector(selector, options) {
      return this._waitForSelectorOrXPath(selector, false, options);
    }
  
    /**
     * @param {string} xpath
     * @param {!{visible?: boolean, hidden?: boolean, timeout?: number}=} options
     * @return {!Promise<?Puppeteer.ElementHandle>}
     */
    waitForXPath(xpath, options) {
      return this._waitForSelectorOrXPath(xpath, true, options);
    }
  
    /**
     * @param {Function|string} pageFunction
     * @param {!{polling?: string|number, timeout?: number}=} options
     * @return {!Promise<!Puppeteer.JSHandle>}
     */
    waitForFunction(pageFunction, options = {}, ...args) {
      const {
        polling = 'raf',
        timeout = this._timeoutSettings.timeout(),
      } = options;
      return new WaitTask(this, pageFunction, 'function', polling, timeout, ...args).promise;
    }
  
    /**
     * @return {!Promise<string>}
     */
    async title() {
      return this.evaluate(() => document.title);
    }
  
    /**
     * @param {string} selectorOrXPath
     * @param {boolean} isXPath
     * @param {!{visible?: boolean, hidden?: boolean, timeout?: number}=} options
     * @return {!Promise<?Puppeteer.ElementHandle>}
     */
    async _waitForSelectorOrXPath(selectorOrXPath, isXPath, options = {}) {
      const {
        visible: waitForVisible = false,
        hidden: waitForHidden = false,
        timeout = this._timeoutSettings.timeout(),
      } = options;
      const polling = waitForVisible || waitForHidden ? 'raf' : 'mutation';
      const title = `${isXPath ? 'XPath' : 'selector'} "${selectorOrXPath}"${waitForHidden ? ' to be hidden' : ''}`;
      const waitTask = new WaitTask(this, predicate, title, polling, timeout, selectorOrXPath, isXPath, waitForVisible, waitForHidden);
      const handle = await waitTask.promise;
      if (!handle.asElement()) {
        await handle.dispose();
        return null;
      }
      return handle.asElement();
  
      /**
       * @param {string} selectorOrXPath
       * @param {boolean} isXPath
       * @param {boolean} waitForVisible
       * @param {boolean} waitForHidden
       * @return {?Node|boolean}
       */
      function predicate(selectorOrXPath, isXPath, waitForVisible, waitForHidden) {
        const node = isXPath
          ? document.evaluate(selectorOrXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
          : document.querySelector(selectorOrXPath);
        if (!node)
          return waitForHidden;
        if (!waitForVisible && !waitForHidden)
          return node;
        const element = /** @type {Element} */ (node.nodeType === Node.TEXT_NODE ? node.parentElement : node);
  
        const style = window.getComputedStyle(element);
        const isVisible = style && style.visibility !== 'hidden' && hasVisibleBoundingBox();
        const success = (waitForVisible === isVisible || waitForHidden === !isVisible);
        return success ? node : null;
  
        /**
         * @return {boolean}
         */
        function hasVisibleBoundingBox() {
          const rect = element.getBoundingClientRect();
          return !!(rect.top || rect.bottom || rect.width || rect.height);
        }
      }
    }
  }
  
  class WaitTask {
    /**
     * @param {!DOMWorld} domWorld
     * @param {Function|string} predicateBody
     * @param {string|number} polling
     * @param {number} timeout
     * @param {!Array<*>} args
     */
    constructor(domWorld, predicateBody, title, polling, timeout, ...args) {
      if (helper.isString(polling))
        assert(polling === 'raf' || polling === 'mutation', 'Unknown polling option: ' + polling);
      else if (helper.isNumber(polling))
        assert(polling > 0, 'Cannot poll with non-positive interval: ' + polling);
      else
        throw new Error('Unknown polling options: ' + polling);
  
      this._domWorld = domWorld;
      this._polling = polling;
      this._timeout = timeout;
      this._predicateBody = helper.isString(predicateBody) ? 'return (' + predicateBody + ')' : 'return (' + predicateBody + ')(...args)';
      this._args = args;
      this._runCount = 0;
      domWorld._waitTasks.add(this);
      this.promise = new Promise((resolve, reject) => {
        this._resolve = resolve;
        this._reject = reject;
      });
      // Since page navigation requires us to re-install the pageScript, we should track
      // timeout on our end.
      if (timeout) {
        const timeoutError = new TimeoutError(`waiting for ${title} failed: timeout ${timeout}ms exceeded`);
        this._timeoutTimer = setTimeout(() => this.terminate(timeoutError), timeout);
      }
      this.rerun();
    }
  
    /**
     * @param {!Error} error
     */
    terminate(error) {
      this._terminated = true;
      this._reject(error);
      this._cleanup();
    }
  
    async rerun() {
      const runCount = ++this._runCount;
      /** @type {?Puppeteer.JSHandle} */
      let success = null;
      let error = null;
      try {
        success = await (await this._domWorld.executionContext()).evaluateHandle(waitForPredicatePageFunction, this._predicateBody, this._polling, this._timeout, ...this._args);
      } catch (e) {
        error = e;
      }
  
      if (this._terminated || runCount !== this._runCount) {
        if (success)
          await success.dispose();
        return;
      }
  
      // Ignore timeouts in pageScript - we track timeouts ourselves.
      // If the frame's execution context has already changed, `frame.evaluate` will
      // throw an error - ignore this predicate run altogether.
      if (!error && await this._domWorld.evaluate(s => !s, success).catch(e => true)) {
        await success.dispose();
        return;
      }
  
      // When the page is navigated, the promise is rejected.
      // We will try again in the new execution context.
      if (error && error.message.includes('Execution context was destroyed'))
        return;
  
      // We could have tried to evaluate in a context which was already
      // destroyed.
      if (error && error.message.includes('Cannot find context with specified id'))
        return;
  
      if (error)
        this._reject(error);
      else
        this._resolve(success);
  
      this._cleanup();
    }
  
    _cleanup() {
      clearTimeout(this._timeoutTimer);
      this._domWorld._waitTasks.delete(this);
      this._runningTask = null;
    }
  }
  
  /**
   * @param {string} predicateBody
   * @param {string} polling
   * @param {number} timeout
   * @return {!Promise<*>}
   */
  async function waitForPredicatePageFunction(predicateBody, polling, timeout, ...args) {
    const predicate = new Function('...args', predicateBody);
    let timedOut = false;
    if (timeout)
      setTimeout(() => timedOut = true, timeout);
    if (polling === 'raf')
      return await pollRaf();
    if (polling === 'mutation')
      return await pollMutation();
    if (typeof polling === 'number')
      return await pollInterval(polling);
  
    /**
     * @return {!Promise<*>}
     */
    function pollMutation() {
      const success = predicate.apply(null, args);
      if (success)
        return Promise.resolve(success);
  
      let fulfill;
      const result = new Promise(x => fulfill = x);
      const observer = new MutationObserver(mutations => {
        if (timedOut) {
          observer.disconnect();
          fulfill();
        }
        const success = predicate.apply(null, args);
        if (success) {
          observer.disconnect();
          fulfill(success);
        }
      });
      observer.observe(document, {
        childList: true,
        subtree: true,
        attributes: true
      });
      return result;
    }
  
    /**
     * @return {!Promise<*>}
     */
    function pollRaf() {
      let fulfill;
      const result = new Promise(x => fulfill = x);
      onRaf();
      return result;
  
      function onRaf() {
        if (timedOut) {
          fulfill();
          return;
        }
        const success = predicate.apply(null, args);
        if (success)
          fulfill(success);
        else
          requestAnimationFrame(onRaf);
      }
    }
  
    /**
     * @param {number} pollInterval
     * @return {!Promise<*>}
     */
    function pollInterval(pollInterval) {
      let fulfill;
      const result = new Promise(x => fulfill = x);
      onTimeout();
      return result;
  
      function onTimeout() {
        if (timedOut) {
          fulfill();
          return;
        }
        const success = predicate.apply(null, args);
        if (success)
          fulfill(success);
        else
          setTimeout(onTimeout, pollInterval);
      }
    }
  }
  
  module.exports = {DOMWorld};
  
  },{"./Errors":49,"./LifecycleWatcher":56,"./helper":69,"fs":2}],46:[function(require,module,exports){
  /**
   * Copyright 2017 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  
  module.exports = [
    {
      'name': 'Blackberry PlayBook',
      'userAgent': 'Mozilla/5.0 (PlayBook; U; RIM Tablet OS 2.1.0; en-US) AppleWebKit/536.2+ (KHTML like Gecko) Version/7.2.1.0 Safari/536.2+',
      'viewport': {
        'width': 600,
        'height': 1024,
        'deviceScaleFactor': 1,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'Blackberry PlayBook landscape',
      'userAgent': 'Mozilla/5.0 (PlayBook; U; RIM Tablet OS 2.1.0; en-US) AppleWebKit/536.2+ (KHTML like Gecko) Version/7.2.1.0 Safari/536.2+',
      'viewport': {
        'width': 1024,
        'height': 600,
        'deviceScaleFactor': 1,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'BlackBerry Z30',
      'userAgent': 'Mozilla/5.0 (BB10; Touch) AppleWebKit/537.10+ (KHTML, like Gecko) Version/10.0.9.2372 Mobile Safari/537.10+',
      'viewport': {
        'width': 360,
        'height': 640,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'BlackBerry Z30 landscape',
      'userAgent': 'Mozilla/5.0 (BB10; Touch) AppleWebKit/537.10+ (KHTML, like Gecko) Version/10.0.9.2372 Mobile Safari/537.10+',
      'viewport': {
        'width': 640,
        'height': 360,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'Galaxy Note 3',
      'userAgent': 'Mozilla/5.0 (Linux; U; Android 4.3; en-us; SM-N900T Build/JSS15J) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
      'viewport': {
        'width': 360,
        'height': 640,
        'deviceScaleFactor': 3,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'Galaxy Note 3 landscape',
      'userAgent': 'Mozilla/5.0 (Linux; U; Android 4.3; en-us; SM-N900T Build/JSS15J) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
      'viewport': {
        'width': 640,
        'height': 360,
        'deviceScaleFactor': 3,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'Galaxy Note II',
      'userAgent': 'Mozilla/5.0 (Linux; U; Android 4.1; en-us; GT-N7100 Build/JRO03C) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
      'viewport': {
        'width': 360,
        'height': 640,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'Galaxy Note II landscape',
      'userAgent': 'Mozilla/5.0 (Linux; U; Android 4.1; en-us; GT-N7100 Build/JRO03C) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
      'viewport': {
        'width': 640,
        'height': 360,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'Galaxy S III',
      'userAgent': 'Mozilla/5.0 (Linux; U; Android 4.0; en-us; GT-I9300 Build/IMM76D) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
      'viewport': {
        'width': 360,
        'height': 640,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'Galaxy S III landscape',
      'userAgent': 'Mozilla/5.0 (Linux; U; Android 4.0; en-us; GT-I9300 Build/IMM76D) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
      'viewport': {
        'width': 640,
        'height': 360,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'Galaxy S5',
      'userAgent': 'Mozilla/5.0 (Linux; Android 5.0; SM-G900P Build/LRX21T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Mobile Safari/537.36',
      'viewport': {
        'width': 360,
        'height': 640,
        'deviceScaleFactor': 3,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'Galaxy S5 landscape',
      'userAgent': 'Mozilla/5.0 (Linux; Android 5.0; SM-G900P Build/LRX21T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Mobile Safari/537.36',
      'viewport': {
        'width': 640,
        'height': 360,
        'deviceScaleFactor': 3,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'iPad',
      'userAgent': 'Mozilla/5.0 (iPad; CPU OS 11_0 like Mac OS X) AppleWebKit/604.1.34 (KHTML, like Gecko) Version/11.0 Mobile/15A5341f Safari/604.1',
      'viewport': {
        'width': 768,
        'height': 1024,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'iPad landscape',
      'userAgent': 'Mozilla/5.0 (iPad; CPU OS 11_0 like Mac OS X) AppleWebKit/604.1.34 (KHTML, like Gecko) Version/11.0 Mobile/15A5341f Safari/604.1',
      'viewport': {
        'width': 1024,
        'height': 768,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'iPad Mini',
      'userAgent': 'Mozilla/5.0 (iPad; CPU OS 11_0 like Mac OS X) AppleWebKit/604.1.34 (KHTML, like Gecko) Version/11.0 Mobile/15A5341f Safari/604.1',
      'viewport': {
        'width': 768,
        'height': 1024,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'iPad Mini landscape',
      'userAgent': 'Mozilla/5.0 (iPad; CPU OS 11_0 like Mac OS X) AppleWebKit/604.1.34 (KHTML, like Gecko) Version/11.0 Mobile/15A5341f Safari/604.1',
      'viewport': {
        'width': 1024,
        'height': 768,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'iPad Pro',
      'userAgent': 'Mozilla/5.0 (iPad; CPU OS 11_0 like Mac OS X) AppleWebKit/604.1.34 (KHTML, like Gecko) Version/11.0 Mobile/15A5341f Safari/604.1',
      'viewport': {
        'width': 1024,
        'height': 1366,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'iPad Pro landscape',
      'userAgent': 'Mozilla/5.0 (iPad; CPU OS 11_0 like Mac OS X) AppleWebKit/604.1.34 (KHTML, like Gecko) Version/11.0 Mobile/15A5341f Safari/604.1',
      'viewport': {
        'width': 1366,
        'height': 1024,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'iPhone 4',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 7_1_2 like Mac OS X) AppleWebKit/537.51.2 (KHTML, like Gecko) Version/7.0 Mobile/11D257 Safari/9537.53',
      'viewport': {
        'width': 320,
        'height': 480,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'iPhone 4 landscape',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 7_1_2 like Mac OS X) AppleWebKit/537.51.2 (KHTML, like Gecko) Version/7.0 Mobile/11D257 Safari/9537.53',
      'viewport': {
        'width': 480,
        'height': 320,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'iPhone 5',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_1 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Version/10.0 Mobile/14E304 Safari/602.1',
      'viewport': {
        'width': 320,
        'height': 568,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'iPhone 5 landscape',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_1 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Version/10.0 Mobile/14E304 Safari/602.1',
      'viewport': {
        'width': 568,
        'height': 320,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'iPhone 6',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
      'viewport': {
        'width': 375,
        'height': 667,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'iPhone 6 landscape',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
      'viewport': {
        'width': 667,
        'height': 375,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'iPhone 6 Plus',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
      'viewport': {
        'width': 414,
        'height': 736,
        'deviceScaleFactor': 3,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'iPhone 6 Plus landscape',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
      'viewport': {
        'width': 736,
        'height': 414,
        'deviceScaleFactor': 3,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'iPhone 7',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
      'viewport': {
        'width': 375,
        'height': 667,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'iPhone 7 landscape',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
      'viewport': {
        'width': 667,
        'height': 375,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'iPhone 7 Plus',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
      'viewport': {
        'width': 414,
        'height': 736,
        'deviceScaleFactor': 3,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'iPhone 7 Plus landscape',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
      'viewport': {
        'width': 736,
        'height': 414,
        'deviceScaleFactor': 3,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'iPhone 8',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
      'viewport': {
        'width': 375,
        'height': 667,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'iPhone 8 landscape',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
      'viewport': {
        'width': 667,
        'height': 375,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'iPhone 8 Plus',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
      'viewport': {
        'width': 414,
        'height': 736,
        'deviceScaleFactor': 3,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'iPhone 8 Plus landscape',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
      'viewport': {
        'width': 736,
        'height': 414,
        'deviceScaleFactor': 3,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'iPhone SE',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_1 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Version/10.0 Mobile/14E304 Safari/602.1',
      'viewport': {
        'width': 320,
        'height': 568,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'iPhone SE landscape',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_1 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Version/10.0 Mobile/14E304 Safari/602.1',
      'viewport': {
        'width': 568,
        'height': 320,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'iPhone X',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
      'viewport': {
        'width': 375,
        'height': 812,
        'deviceScaleFactor': 3,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'iPhone X landscape',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
      'viewport': {
        'width': 812,
        'height': 375,
        'deviceScaleFactor': 3,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'iPhone XR',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 12_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.0 Mobile/15E148 Safari/604.1',
      'viewport': {
        'width': 414,
        'height': 896,
        'deviceScaleFactor': 3,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'iPhone XR landscape',
      'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 12_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.0 Mobile/15E148 Safari/604.1',
      'viewport': {
        'width': 896,
        'height': 414,
        'deviceScaleFactor': 3,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'JioPhone 2',
      'userAgent': 'Mozilla/5.0 (Mobile; LYF/F300B/LYF-F300B-001-01-15-130718-i;Android; rv:48.0) Gecko/48.0 Firefox/48.0 KAIOS/2.5',
      'viewport': {
        'width': 240,
        'height': 320,
        'deviceScaleFactor': 1,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'JioPhone 2 landscape',
      'userAgent': 'Mozilla/5.0 (Mobile; LYF/F300B/LYF-F300B-001-01-15-130718-i;Android; rv:48.0) Gecko/48.0 Firefox/48.0 KAIOS/2.5',
      'viewport': {
        'width': 320,
        'height': 240,
        'deviceScaleFactor': 1,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'Kindle Fire HDX',
      'userAgent': 'Mozilla/5.0 (Linux; U; en-us; KFAPWI Build/JDQ39) AppleWebKit/535.19 (KHTML, like Gecko) Silk/3.13 Safari/535.19 Silk-Accelerated=true',
      'viewport': {
        'width': 800,
        'height': 1280,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'Kindle Fire HDX landscape',
      'userAgent': 'Mozilla/5.0 (Linux; U; en-us; KFAPWI Build/JDQ39) AppleWebKit/535.19 (KHTML, like Gecko) Silk/3.13 Safari/535.19 Silk-Accelerated=true',
      'viewport': {
        'width': 1280,
        'height': 800,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'LG Optimus L70',
      'userAgent': 'Mozilla/5.0 (Linux; U; Android 4.4.2; en-us; LGMS323 Build/KOT49I.MS32310c) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/75.0.3765.0 Mobile Safari/537.36',
      'viewport': {
        'width': 384,
        'height': 640,
        'deviceScaleFactor': 1.25,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'LG Optimus L70 landscape',
      'userAgent': 'Mozilla/5.0 (Linux; U; Android 4.4.2; en-us; LGMS323 Build/KOT49I.MS32310c) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/75.0.3765.0 Mobile Safari/537.36',
      'viewport': {
        'width': 640,
        'height': 384,
        'deviceScaleFactor': 1.25,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'Microsoft Lumia 550',
      'userAgent': 'Mozilla/5.0 (Windows Phone 10.0; Android 4.2.1; Microsoft; Lumia 550) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/46.0.2486.0 Mobile Safari/537.36 Edge/14.14263',
      'viewport': {
        'width': 640,
        'height': 360,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'Microsoft Lumia 950',
      'userAgent': 'Mozilla/5.0 (Windows Phone 10.0; Android 4.2.1; Microsoft; Lumia 950) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/46.0.2486.0 Mobile Safari/537.36 Edge/14.14263',
      'viewport': {
        'width': 360,
        'height': 640,
        'deviceScaleFactor': 4,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'Microsoft Lumia 950 landscape',
      'userAgent': 'Mozilla/5.0 (Windows Phone 10.0; Android 4.2.1; Microsoft; Lumia 950) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/46.0.2486.0 Mobile Safari/537.36 Edge/14.14263',
      'viewport': {
        'width': 640,
        'height': 360,
        'deviceScaleFactor': 4,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'Nexus 10',
      'userAgent': 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 10 Build/MOB31T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Safari/537.36',
      'viewport': {
        'width': 800,
        'height': 1280,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'Nexus 10 landscape',
      'userAgent': 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 10 Build/MOB31T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Safari/537.36',
      'viewport': {
        'width': 1280,
        'height': 800,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'Nexus 4',
      'userAgent': 'Mozilla/5.0 (Linux; Android 4.4.2; Nexus 4 Build/KOT49H) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Mobile Safari/537.36',
      'viewport': {
        'width': 384,
        'height': 640,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'Nexus 4 landscape',
      'userAgent': 'Mozilla/5.0 (Linux; Android 4.4.2; Nexus 4 Build/KOT49H) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Mobile Safari/537.36',
      'viewport': {
        'width': 640,
        'height': 384,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'Nexus 5',
      'userAgent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Mobile Safari/537.36',
      'viewport': {
        'width': 360,
        'height': 640,
        'deviceScaleFactor': 3,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'Nexus 5 landscape',
      'userAgent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Mobile Safari/537.36',
      'viewport': {
        'width': 640,
        'height': 360,
        'deviceScaleFactor': 3,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'Nexus 5X',
      'userAgent': 'Mozilla/5.0 (Linux; Android 8.0.0; Nexus 5X Build/OPR4.170623.006) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Mobile Safari/537.36',
      'viewport': {
        'width': 412,
        'height': 732,
        'deviceScaleFactor': 2.625,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'Nexus 5X landscape',
      'userAgent': 'Mozilla/5.0 (Linux; Android 8.0.0; Nexus 5X Build/OPR4.170623.006) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Mobile Safari/537.36',
      'viewport': {
        'width': 732,
        'height': 412,
        'deviceScaleFactor': 2.625,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'Nexus 6',
      'userAgent': 'Mozilla/5.0 (Linux; Android 7.1.1; Nexus 6 Build/N6F26U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Mobile Safari/537.36',
      'viewport': {
        'width': 412,
        'height': 732,
        'deviceScaleFactor': 3.5,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'Nexus 6 landscape',
      'userAgent': 'Mozilla/5.0 (Linux; Android 7.1.1; Nexus 6 Build/N6F26U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Mobile Safari/537.36',
      'viewport': {
        'width': 732,
        'height': 412,
        'deviceScaleFactor': 3.5,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'Nexus 6P',
      'userAgent': 'Mozilla/5.0 (Linux; Android 8.0.0; Nexus 6P Build/OPP3.170518.006) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Mobile Safari/537.36',
      'viewport': {
        'width': 412,
        'height': 732,
        'deviceScaleFactor': 3.5,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'Nexus 6P landscape',
      'userAgent': 'Mozilla/5.0 (Linux; Android 8.0.0; Nexus 6P Build/OPP3.170518.006) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Mobile Safari/537.36',
      'viewport': {
        'width': 732,
        'height': 412,
        'deviceScaleFactor': 3.5,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'Nexus 7',
      'userAgent': 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 7 Build/MOB30X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Safari/537.36',
      'viewport': {
        'width': 600,
        'height': 960,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'Nexus 7 landscape',
      'userAgent': 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 7 Build/MOB30X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Safari/537.36',
      'viewport': {
        'width': 960,
        'height': 600,
        'deviceScaleFactor': 2,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'Nokia Lumia 520',
      'userAgent': 'Mozilla/5.0 (compatible; MSIE 10.0; Windows Phone 8.0; Trident/6.0; IEMobile/10.0; ARM; Touch; NOKIA; Lumia 520)',
      'viewport': {
        'width': 320,
        'height': 533,
        'deviceScaleFactor': 1.5,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'Nokia Lumia 520 landscape',
      'userAgent': 'Mozilla/5.0 (compatible; MSIE 10.0; Windows Phone 8.0; Trident/6.0; IEMobile/10.0; ARM; Touch; NOKIA; Lumia 520)',
      'viewport': {
        'width': 533,
        'height': 320,
        'deviceScaleFactor': 1.5,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'Nokia N9',
      'userAgent': 'Mozilla/5.0 (MeeGo; NokiaN9) AppleWebKit/534.13 (KHTML, like Gecko) NokiaBrowser/8.5.0 Mobile Safari/534.13',
      'viewport': {
        'width': 480,
        'height': 854,
        'deviceScaleFactor': 1,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'Nokia N9 landscape',
      'userAgent': 'Mozilla/5.0 (MeeGo; NokiaN9) AppleWebKit/534.13 (KHTML, like Gecko) NokiaBrowser/8.5.0 Mobile Safari/534.13',
      'viewport': {
        'width': 854,
        'height': 480,
        'deviceScaleFactor': 1,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'Pixel 2',
      'userAgent': 'Mozilla/5.0 (Linux; Android 8.0; Pixel 2 Build/OPD3.170816.012) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Mobile Safari/537.36',
      'viewport': {
        'width': 411,
        'height': 731,
        'deviceScaleFactor': 2.625,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'Pixel 2 landscape',
      'userAgent': 'Mozilla/5.0 (Linux; Android 8.0; Pixel 2 Build/OPD3.170816.012) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Mobile Safari/537.36',
      'viewport': {
        'width': 731,
        'height': 411,
        'deviceScaleFactor': 2.625,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    },
    {
      'name': 'Pixel 2 XL',
      'userAgent': 'Mozilla/5.0 (Linux; Android 8.0.0; Pixel 2 XL Build/OPD1.170816.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Mobile Safari/537.36',
      'viewport': {
        'width': 411,
        'height': 823,
        'deviceScaleFactor': 3.5,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': false
      }
    },
    {
      'name': 'Pixel 2 XL landscape',
      'userAgent': 'Mozilla/5.0 (Linux; Android 8.0.0; Pixel 2 XL Build/OPD1.170816.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3765.0 Mobile Safari/537.36',
      'viewport': {
        'width': 823,
        'height': 411,
        'deviceScaleFactor': 3.5,
        'isMobile': true,
        'hasTouch': true,
        'isLandscape': true
      }
    }
  ];
  for (const device of module.exports)
    module.exports[device.name] = device;
  
  },{}],47:[function(require,module,exports){
  /**
   * Copyright 2017 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  
  const {assert} = require('./helper');
  
  class Dialog {
    /**
     * @param {!Puppeteer.CDPSession} client
     * @param {string} type
     * @param {string} message
     * @param {(string|undefined)} defaultValue
     */
    constructor(client, type, message, defaultValue = '') {
      this._client = client;
      this._type = type;
      this._message = message;
      this._handled = false;
      this._defaultValue = defaultValue;
    }
  
    /**
     * @return {string}
     */
    type() {
      return this._type;
    }
  
    /**
     * @return {string}
     */
    message() {
      return this._message;
    }
  
    /**
     * @return {string}
     */
    defaultValue() {
      return this._defaultValue;
    }
  
    /**
     * @param {string=} promptText
     */
    async accept(promptText) {
      assert(!this._handled, 'Cannot accept dialog which is already handled!');
      this._handled = true;
      await this._client.send('Page.handleJavaScriptDialog', {
        accept: true,
        promptText: promptText
      });
    }
  
    async dismiss() {
      assert(!this._handled, 'Cannot dismiss dialog which is already handled!');
      this._handled = true;
      await this._client.send('Page.handleJavaScriptDialog', {
        accept: false
      });
    }
  }
  
  Dialog.Type = {
    Alert: 'alert',
    BeforeUnload: 'beforeunload',
    Confirm: 'confirm',
    Prompt: 'prompt'
  };
  
  module.exports = {Dialog};
  
  },{"./helper":69}],48:[function(require,module,exports){
  /**
   * Copyright 2017 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  
  class EmulationManager {
    /**
     * @param {!Puppeteer.CDPSession} client
     */
    constructor(client) {
      this._client = client;
      this._emulatingMobile = false;
      this._hasTouch = false;
    }
  
    /**
     * @param {!Puppeteer.Viewport} viewport
     * @return {Promise<boolean>}
     */
    async emulateViewport(viewport) {
      const mobile = viewport.isMobile || false;
      const width = viewport.width;
      const height = viewport.height;
      const deviceScaleFactor = viewport.deviceScaleFactor || 1;
      /** @type {Protocol.Emulation.ScreenOrientation} */
      const screenOrientation = viewport.isLandscape ? { angle: 90, type: 'landscapePrimary' } : { angle: 0, type: 'portraitPrimary' };
      const hasTouch = viewport.hasTouch || false;
  
      await Promise.all([
        this._client.send('Emulation.setDeviceMetricsOverride', { mobile, width, height, deviceScaleFactor, screenOrientation }),
        this._client.send('Emulation.setTouchEmulationEnabled', {
          enabled: hasTouch
        })
      ]);
  
      const reloadNeeded = this._emulatingMobile !== mobile || this._hasTouch !== hasTouch;
      this._emulatingMobile = mobile;
      this._hasTouch = hasTouch;
      return reloadNeeded;
    }
  }
  
  module.exports = {EmulationManager};
  
  },{}],49:[function(require,module,exports){
  /**
   * Copyright 2018 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  
  class CustomError extends Error {
    constructor(message) {
      super(message);
      this.name = this.constructor.name;
      Error.captureStackTrace(this, this.constructor);
    }
  }
  
  class TimeoutError extends CustomError {}
  
  module.exports = {
    TimeoutError,
  };
  
  },{}],50:[function(require,module,exports){
  /**
   * Copyright 2019 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  
  const Events = {
    Page: {
      Close: 'close',
      Console: 'console',
      Dialog: 'dialog',
      DOMContentLoaded: 'domcontentloaded',
      Error: 'error',
      // Can't use just 'error' due to node.js special treatment of error events.
      // @see https://nodejs.org/api/events.html#events_error_events
      PageError: 'pageerror',
      Request: 'request',
      Response: 'response',
      RequestFailed: 'requestfailed',
      RequestFinished: 'requestfinished',
      FrameAttached: 'frameattached',
      FrameDetached: 'framedetached',
      FrameNavigated: 'framenavigated',
      Load: 'load',
      Metrics: 'metrics',
      Popup: 'popup',
      WorkerCreated: 'workercreated',
      WorkerDestroyed: 'workerdestroyed',
    },
  
    Browser: {
      TargetCreated: 'targetcreated',
      TargetDestroyed: 'targetdestroyed',
      TargetChanged: 'targetchanged',
      Disconnected: 'disconnected'
    },
  
    BrowserContext: {
      TargetCreated: 'targetcreated',
      TargetDestroyed: 'targetdestroyed',
      TargetChanged: 'targetchanged',
    },
  
    NetworkManager: {
      Request: Symbol('Events.NetworkManager.Request'),
      Response: Symbol('Events.NetworkManager.Response'),
      RequestFailed: Symbol('Events.NetworkManager.RequestFailed'),
      RequestFinished: Symbol('Events.NetworkManager.RequestFinished'),
    },
  
    FrameManager: {
      FrameAttached: Symbol('Events.FrameManager.FrameAttached'),
      FrameNavigated: Symbol('Events.FrameManager.FrameNavigated'),
      FrameDetached: Symbol('Events.FrameManager.FrameDetached'),
      LifecycleEvent: Symbol('Events.FrameManager.LifecycleEvent'),
      FrameNavigatedWithinDocument: Symbol('Events.FrameManager.FrameNavigatedWithinDocument'),
      ExecutionContextCreated: Symbol('Events.FrameManager.ExecutionContextCreated'),
      ExecutionContextDestroyed: Symbol('Events.FrameManager.ExecutionContextDestroyed'),
    },
  
    Connection: {
      Disconnected: Symbol('Events.Connection.Disconnected'),
    },
  
    CDPSession: {
      Disconnected: Symbol('Events.CDPSession.Disconnected'),
    },
  };
  
  module.exports = { Events };
  
  },{}],51:[function(require,module,exports){
  /**
   * Copyright 2017 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  
  const {helper, assert} = require('./helper');
  const {createJSHandle, JSHandle} = require('./JSHandle');
  
  const EVALUATION_SCRIPT_URL = '__puppeteer_evaluation_script__';
  const SOURCE_URL_REGEX = /^[\040\t]*\/\/[@#] sourceURL=\s*(\S*?)\s*$/m;
  
  class ExecutionContext {
    /**
     * @param {!Puppeteer.CDPSession} client
     * @param {!Protocol.Runtime.ExecutionContextDescription} contextPayload
     * @param {?Puppeteer.DOMWorld} world
     */
    constructor(client, contextPayload, world) {
      this._client = client;
      this._world = world;
      this._contextId = contextPayload.id;
    }
  
    /**
     * @return {?Puppeteer.Frame}
     */
    frame() {
      return this._world ? this._world.frame() : null;
    }
  
    /**
     * @param {Function|string} pageFunction
     * @param {...*} args
     * @return {!Promise<*>}
     */
    async evaluate(pageFunction, ...args) {
      return await this._evaluateInternal(true /* returnByValue */, pageFunction, ...args);
    }
  
    /**
     * @param {Function|string} pageFunction
     * @param {...*} args
     * @return {!Promise<!JSHandle>}
     */
    async evaluateHandle(pageFunction, ...args) {
      return this._evaluateInternal(false /* returnByValue */, pageFunction, ...args);
    }
  
    /**
     * @param {boolean} returnByValue
     * @param {Function|string} pageFunction
     * @param {...*} args
     * @return {!Promise<*>}
     */
    async _evaluateInternal(returnByValue, pageFunction, ...args) {
      const suffix = `//# sourceURL=${EVALUATION_SCRIPT_URL}`;
  
      if (helper.isString(pageFunction)) {
        const contextId = this._contextId;
        const expression = /** @type {string} */ (pageFunction);
        const expressionWithSourceUrl = SOURCE_URL_REGEX.test(expression) ? expression : expression + '\n' + suffix;
        const {exceptionDetails, result: remoteObject} = await this._client.send('Runtime.evaluate', {
          expression: expressionWithSourceUrl,
          contextId,
          returnByValue,
          awaitPromise: true,
          userGesture: true
        }).catch(rewriteError);
        if (exceptionDetails)
          throw new Error('Evaluation failed: ' + helper.getExceptionMessage(exceptionDetails));
        return returnByValue ? helper.valueFromRemoteObject(remoteObject) : createJSHandle(this, remoteObject);
      }
  
      if (typeof pageFunction !== 'function')
        throw new Error(`Expected to get |string| or |function| as the first argument, but got "${pageFunction}" instead.`);
  
      let functionText = pageFunction.toString();
      try {
        new Function('(' + functionText + ')');
      } catch (e1) {
        // This means we might have a function shorthand. Try another
        // time prefixing 'function '.
        if (functionText.startsWith('async '))
          functionText = 'async function ' + functionText.substring('async '.length);
        else
          functionText = 'function ' + functionText;
        try {
          new Function('(' + functionText  + ')');
        } catch (e2) {
          // We tried hard to serialize, but there's a weird beast here.
          throw new Error('Passed function is not well-serializable!');
        }
      }
      let callFunctionOnPromise;
      try {
        callFunctionOnPromise = this._client.send('Runtime.callFunctionOn', {
          functionDeclaration: functionText + '\n' + suffix + '\n',
          executionContextId: this._contextId,
          arguments: args.map(convertArgument.bind(this)),
          returnByValue,
          awaitPromise: true,
          userGesture: true
        });
      } catch (err) {
        if (err instanceof TypeError && err.message.startsWith('Converting circular structure to JSON'))
          err.message += ' Are you passing a nested JSHandle?';
        throw err;
      }
      const { exceptionDetails, result: remoteObject } = await callFunctionOnPromise.catch(rewriteError);
      if (exceptionDetails)
        throw new Error('Evaluation failed: ' + helper.getExceptionMessage(exceptionDetails));
      return returnByValue ? helper.valueFromRemoteObject(remoteObject) : createJSHandle(this, remoteObject);
  
      /**
       * @param {*} arg
       * @return {*}
       * @this {ExecutionContext}
       */
      function convertArgument(arg) {
        if (typeof arg === 'bigint') // eslint-disable-line valid-typeof
          return { unserializableValue: `${arg.toString()}n` };
        if (Object.is(arg, -0))
          return { unserializableValue: '-0' };
        if (Object.is(arg, Infinity))
          return { unserializableValue: 'Infinity' };
        if (Object.is(arg, -Infinity))
          return { unserializableValue: '-Infinity' };
        if (Object.is(arg, NaN))
          return { unserializableValue: 'NaN' };
        const objectHandle = arg && (arg instanceof JSHandle) ? arg : null;
        if (objectHandle) {
          if (objectHandle._context !== this)
            throw new Error('JSHandles can be evaluated only in the context they were created!');
          if (objectHandle._disposed)
            throw new Error('JSHandle is disposed!');
          if (objectHandle._remoteObject.unserializableValue)
            return { unserializableValue: objectHandle._remoteObject.unserializableValue };
          if (!objectHandle._remoteObject.objectId)
            return { value: objectHandle._remoteObject.value };
          return { objectId: objectHandle._remoteObject.objectId };
        }
        return { value: arg };
      }
  
      /**
       * @param {!Error} error
       * @return {!Protocol.Runtime.evaluateReturnValue}
       */
      function rewriteError(error) {
        if (error.message.includes('Object reference chain is too long'))
          return {result: {type: 'undefined'}};
        if (error.message.includes('Object couldn\'t be returned by value'))
          return {result: {type: 'undefined'}};
  
        if (error.message.endsWith('Cannot find context with specified id') || error.message.endsWith('Inspected target navigated or closed'))
          throw new Error('Execution context was destroyed, most likely because of a navigation.');
        throw error;
      }
    }
  
    /**
     * @param {!JSHandle} prototypeHandle
     * @return {!Promise<!JSHandle>}
     */
    async queryObjects(prototypeHandle) {
      assert(!prototypeHandle._disposed, 'Prototype JSHandle is disposed!');
      assert(prototypeHandle._remoteObject.objectId, 'Prototype JSHandle must not be referencing primitive value');
      const response = await this._client.send('Runtime.queryObjects', {
        prototypeObjectId: prototypeHandle._remoteObject.objectId
      });
      return createJSHandle(this, response.objects);
    }
  
    /**
     * @param {Protocol.DOM.BackendNodeId} backendNodeId
     * @return {Promise<Puppeteer.ElementHandle>}
     */
    async _adoptBackendNodeId(backendNodeId) {
      const {object} = await this._client.send('DOM.resolveNode', {
        backendNodeId: backendNodeId,
        executionContextId: this._contextId,
      });
      return /** @type {Puppeteer.ElementHandle}*/(createJSHandle(this, object));
    }
  
    /**
     * @param {Puppeteer.ElementHandle} elementHandle
     * @return {Promise<Puppeteer.ElementHandle>}
     */
    async _adoptElementHandle(elementHandle) {
      assert(elementHandle.executionContext() !== this, 'Cannot adopt handle that already belongs to this execution context');
      assert(this._world, 'Cannot adopt handle without DOMWorld');
      const nodeInfo = await this._client.send('DOM.describeNode', {
        objectId: elementHandle._remoteObject.objectId,
      });
      return this._adoptBackendNodeId(nodeInfo.node.backendNodeId);
    }
  }
  
  module.exports = {ExecutionContext, EVALUATION_SCRIPT_URL};
  
  },{"./JSHandle":54,"./helper":69}],52:[function(require,module,exports){
  /**
   * Copyright 2017 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  
  const EventEmitter = require('events');
  const {helper, assert, debugError} = require('./helper');
  const {Events} = require('./Events');
  const {ExecutionContext, EVALUATION_SCRIPT_URL} = require('./ExecutionContext');
  const {LifecycleWatcher} = require('./LifecycleWatcher');
  const {DOMWorld} = require('./DOMWorld');
  const {NetworkManager} = require('./NetworkManager');
  
  const UTILITY_WORLD_NAME = '__puppeteer_utility_world__';
  
  class FrameManager extends EventEmitter {
    /**
     * @param {!Puppeteer.CDPSession} client
     * @param {!Puppeteer.Page} page
     * @param {boolean} ignoreHTTPSErrors
     * @param {!Puppeteer.TimeoutSettings} timeoutSettings
     */
    constructor(client, page, ignoreHTTPSErrors, timeoutSettings) {
      super();
      this._client = client;
      this._page = page;
      this._networkManager = new NetworkManager(client, ignoreHTTPSErrors, this);
      this._timeoutSettings = timeoutSettings;
      /** @type {!Map<string, !Frame>} */
      this._frames = new Map();
      /** @type {!Map<number, !ExecutionContext>} */
      this._contextIdToContext = new Map();
      /** @type {!Set<string>} */
      this._isolatedWorlds = new Set();
  
      this._client.on('Page.frameAttached', event => this._onFrameAttached(event.frameId, event.parentFrameId));
      this._client.on('Page.frameNavigated', event => this._onFrameNavigated(event.frame));
      this._client.on('Page.navigatedWithinDocument', event => this._onFrameNavigatedWithinDocument(event.frameId, event.url));
      this._client.on('Page.frameDetached', event => this._onFrameDetached(event.frameId));
      this._client.on('Page.frameStoppedLoading', event => this._onFrameStoppedLoading(event.frameId));
      this._client.on('Runtime.executionContextCreated', event => this._onExecutionContextCreated(event.context));
      this._client.on('Runtime.executionContextDestroyed', event => this._onExecutionContextDestroyed(event.executionContextId));
      this._client.on('Runtime.executionContextsCleared', event => this._onExecutionContextsCleared());
      this._client.on('Page.lifecycleEvent', event => this._onLifecycleEvent(event));
    }
  
    async initialize() {
      const [,{frameTree}] = await Promise.all([
        this._client.send('Page.enable'),
        this._client.send('Page.getFrameTree'),
      ]);
      this._handleFrameTree(frameTree);
      await Promise.all([
        this._client.send('Page.setLifecycleEventsEnabled', { enabled: true }),
        this._client.send('Runtime.enable', {}).then(() => this._ensureIsolatedWorld(UTILITY_WORLD_NAME)),
        this._networkManager.initialize(),
      ]);
    }
  
    /**
     * @return {!NetworkManager}
     */
    networkManager() {
      return this._networkManager;
    }
  
    /**
     * @param {!Puppeteer.Frame} frame
     * @param {string} url
     * @param {!{referer?: string, timeout?: number, waitUntil?: string|!Array<string>}=} options
     * @return {!Promise<?Puppeteer.Response>}
     */
    async navigateFrame(frame, url, options = {}) {
      assertNoLegacyNavigationOptions(options);
      const {
        referer = this._networkManager.extraHTTPHeaders()['referer'],
        waitUntil = ['load'],
        timeout = this._timeoutSettings.navigationTimeout(),
      } = options;
  
      const watcher = new LifecycleWatcher(this, frame, waitUntil, timeout);
      let ensureNewDocumentNavigation = false;
      let error = await Promise.race([
        navigate(this._client, url, referer, frame._id),
        watcher.timeoutOrTerminationPromise(),
      ]);
      if (!error) {
        error = await Promise.race([
          watcher.timeoutOrTerminationPromise(),
          ensureNewDocumentNavigation ? watcher.newDocumentNavigationPromise() : watcher.sameDocumentNavigationPromise(),
        ]);
      }
      watcher.dispose();
      if (error)
        throw error;
      return watcher.navigationResponse();
  
      /**
       * @param {!Puppeteer.CDPSession} client
       * @param {string} url
       * @param {string} referrer
       * @param {string} frameId
       * @return {!Promise<?Error>}
       */
      async function navigate(client, url, referrer, frameId) {
        try {
          const response = await client.send('Page.navigate', {url, referrer, frameId});
          ensureNewDocumentNavigation = !!response.loaderId;
          return response.errorText ? new Error(`${response.errorText} at ${url}`) : null;
        } catch (error) {
          return error;
        }
      }
    }
  
    /**
     * @param {!Puppeteer.Frame} frame
     * @param {!{timeout?: number, waitUntil?: string|!Array<string>}=} options
     * @return {!Promise<?Puppeteer.Response>}
     */
    async waitForFrameNavigation(frame, options = {}) {
      assertNoLegacyNavigationOptions(options);
      const {
        waitUntil = ['load'],
        timeout = this._timeoutSettings.navigationTimeout(),
      } = options;
      const watcher = new LifecycleWatcher(this, frame, waitUntil, timeout);
      const error = await Promise.race([
        watcher.timeoutOrTerminationPromise(),
        watcher.sameDocumentNavigationPromise(),
        watcher.newDocumentNavigationPromise()
      ]);
      watcher.dispose();
      if (error)
        throw error;
      return watcher.navigationResponse();
    }
  
    /**
     * @param {!Protocol.Page.lifecycleEventPayload} event
     */
    _onLifecycleEvent(event) {
      const frame = this._frames.get(event.frameId);
      if (!frame)
        return;
      frame._onLifecycleEvent(event.loaderId, event.name);
      this.emit(Events.FrameManager.LifecycleEvent, frame);
    }
  
    /**
     * @param {string} frameId
     */
    _onFrameStoppedLoading(frameId) {
      const frame = this._frames.get(frameId);
      if (!frame)
        return;
      frame._onLoadingStopped();
      this.emit(Events.FrameManager.LifecycleEvent, frame);
    }
  
    /**
     * @param {!Protocol.Page.FrameTree} frameTree
     */
    _handleFrameTree(frameTree) {
      if (frameTree.frame.parentId)
        this._onFrameAttached(frameTree.frame.id, frameTree.frame.parentId);
      this._onFrameNavigated(frameTree.frame);
      if (!frameTree.childFrames)
        return;
  
      for (const child of frameTree.childFrames)
        this._handleFrameTree(child);
    }
  
    /**
     * @return {!Puppeteer.Page}
     */
    page() {
      return this._page;
    }
  
    /**
     * @return {!Frame}
     */
    mainFrame() {
      return this._mainFrame;
    }
  
    /**
     * @return {!Array<!Frame>}
     */
    frames() {
      return Array.from(this._frames.values());
    }
  
    /**
     * @param {!string} frameId
     * @return {?Frame}
     */
    frame(frameId) {
      return this._frames.get(frameId) || null;
    }
  
    /**
     * @param {string} frameId
     * @param {?string} parentFrameId
     */
    _onFrameAttached(frameId, parentFrameId) {
      if (this._frames.has(frameId))
        return;
      assert(parentFrameId);
      const parentFrame = this._frames.get(parentFrameId);
      const frame = new Frame(this, this._client, parentFrame, frameId);
      this._frames.set(frame._id, frame);
      this.emit(Events.FrameManager.FrameAttached, frame);
    }
  
    /**
     * @param {!Protocol.Page.Frame} framePayload
     */
    _onFrameNavigated(framePayload) {
      const isMainFrame = !framePayload.parentId;
      let frame = isMainFrame ? this._mainFrame : this._frames.get(framePayload.id);
      assert(isMainFrame || frame, 'We either navigate top level or have old version of the navigated frame');
  
      // Detach all child frames first.
      if (frame) {
        for (const child of frame.childFrames())
          this._removeFramesRecursively(child);
      }
  
      // Update or create main frame.
      if (isMainFrame) {
        if (frame) {
          // Update frame id to retain frame identity on cross-process navigation.
          this._frames.delete(frame._id);
          frame._id = framePayload.id;
        } else {
          // Initial main frame navigation.
          frame = new Frame(this, this._client, null, framePayload.id);
        }
        this._frames.set(framePayload.id, frame);
        this._mainFrame = frame;
      }
  
      // Update frame payload.
      frame._navigated(framePayload);
  
      this.emit(Events.FrameManager.FrameNavigated, frame);
    }
  
    /**
     * @param {string} name
     */
    async _ensureIsolatedWorld(name) {
      if (this._isolatedWorlds.has(name))
        return;
      this._isolatedWorlds.add(name);
      await this._client.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `//# sourceURL=${EVALUATION_SCRIPT_URL}`,
        worldName: name,
      }),
      await Promise.all(this.frames().map(frame => this._client.send('Page.createIsolatedWorld', {
        frameId: frame._id,
        grantUniveralAccess: true,
        worldName: name,
      }).catch(debugError))); // frames might be removed before we send this
    }
  
    /**
     * @param {string} frameId
     * @param {string} url
     */
    _onFrameNavigatedWithinDocument(frameId, url) {
      const frame = this._frames.get(frameId);
      if (!frame)
        return;
      frame._navigatedWithinDocument(url);
      this.emit(Events.FrameManager.FrameNavigatedWithinDocument, frame);
      this.emit(Events.FrameManager.FrameNavigated, frame);
    }
  
    /**
     * @param {string} frameId
     */
    _onFrameDetached(frameId) {
      const frame = this._frames.get(frameId);
      if (frame)
        this._removeFramesRecursively(frame);
    }
  
    _onExecutionContextCreated(contextPayload) {
      const frameId = contextPayload.auxData ? contextPayload.auxData.frameId : null;
      const frame = this._frames.get(frameId) || null;
      let world = null;
      if (frame) {
        if (contextPayload.auxData && !!contextPayload.auxData['isDefault']) {
          world = frame._mainWorld;
        } else if (contextPayload.name === UTILITY_WORLD_NAME && !frame._secondaryWorld._hasContext()) {
          // In case of multiple sessions to the same target, there's a race between
          // connections so we might end up creating multiple isolated worlds.
          // We can use either.
          world = frame._secondaryWorld;
        }
      }
      if (contextPayload.auxData && contextPayload.auxData['type'] === 'isolated')
        this._isolatedWorlds.add(contextPayload.name);
      /** @type {!ExecutionContext} */
      const context = new ExecutionContext(this._client, contextPayload, world);
      if (world)
        world._setContext(context);
      this._contextIdToContext.set(contextPayload.id, context);
    }
  
    /**
     * @param {number} executionContextId
     */
    _onExecutionContextDestroyed(executionContextId) {
      const context = this._contextIdToContext.get(executionContextId);
      if (!context)
        return;
      this._contextIdToContext.delete(executionContextId);
      if (context._world)
        context._world._setContext(null);
    }
  
    _onExecutionContextsCleared() {
      for (const context of this._contextIdToContext.values()) {
        if (context._world)
          context._world._setContext(null);
      }
      this._contextIdToContext.clear();
    }
  
    /**
     * @param {number} contextId
     * @return {!ExecutionContext}
     */
    executionContextById(contextId) {
      const context = this._contextIdToContext.get(contextId);
      assert(context, 'INTERNAL ERROR: missing context with id = ' + contextId);
      return context;
    }
  
    /**
     * @param {!Frame} frame
     */
    _removeFramesRecursively(frame) {
      for (const child of frame.childFrames())
        this._removeFramesRecursively(child);
      frame._detach();
      this._frames.delete(frame._id);
      this.emit(Events.FrameManager.FrameDetached, frame);
    }
  }
  
  /**
   * @unrestricted
   */
  class Frame {
    /**
     * @param {!FrameManager} frameManager
     * @param {!Puppeteer.CDPSession} client
     * @param {?Frame} parentFrame
     * @param {string} frameId
     */
    constructor(frameManager, client, parentFrame, frameId) {
      this._frameManager = frameManager;
      this._client = client;
      this._parentFrame = parentFrame;
      this._url = '';
      this._id = frameId;
      this._detached = false;
  
      this._loaderId = '';
      /** @type {!Set<string>} */
      this._lifecycleEvents = new Set();
      /** @type {!DOMWorld} */
      this._mainWorld = new DOMWorld(frameManager, this, frameManager._timeoutSettings);
      /** @type {!DOMWorld} */
      this._secondaryWorld = new DOMWorld(frameManager, this, frameManager._timeoutSettings);
  
      /** @type {!Set<!Frame>} */
      this._childFrames = new Set();
      if (this._parentFrame)
        this._parentFrame._childFrames.add(this);
    }
  
    /**
     * @param {string} url
     * @param {!{referer?: string, timeout?: number, waitUntil?: string|!Array<string>}=} options
     * @return {!Promise<?Puppeteer.Response>}
     */
    async goto(url, options) {
      return await this._frameManager.navigateFrame(this, url, options);
    }
  
    /**
     * @param {!{timeout?: number, waitUntil?: string|!Array<string>}=} options
     * @return {!Promise<?Puppeteer.Response>}
     */
    async waitForNavigation(options) {
      return await this._frameManager.waitForFrameNavigation(this, options);
    }
  
    /**
     * @return {!Promise<!ExecutionContext>}
     */
    executionContext() {
      return this._mainWorld.executionContext();
    }
  
    /**
     * @param {Function|string} pageFunction
     * @param {!Array<*>} args
     * @return {!Promise<!Puppeteer.JSHandle>}
     */
    async evaluateHandle(pageFunction, ...args) {
      return this._mainWorld.evaluateHandle(pageFunction, ...args);
    }
  
    /**
     * @param {Function|string} pageFunction
     * @param {!Array<*>} args
     * @return {!Promise<*>}
     */
    async evaluate(pageFunction, ...args) {
      return this._mainWorld.evaluate(pageFunction, ...args);
    }
  
    /**
     * @param {string} selector
     * @return {!Promise<?Puppeteer.ElementHandle>}
     */
    async $(selector) {
      return this._mainWorld.$(selector);
    }
  
    /**
     * @param {string} expression
     * @return {!Promise<!Array<!Puppeteer.ElementHandle>>}
     */
    async $x(expression) {
      return this._mainWorld.$x(expression);
    }
  
    /**
     * @param {string} selector
     * @param {Function|string} pageFunction
     * @param {!Array<*>} args
     * @return {!Promise<(!Object|undefined)>}
     */
    async $eval(selector, pageFunction, ...args) {
      return this._mainWorld.$eval(selector, pageFunction, ...args);
    }
  
    /**
     * @param {string} selector
     * @param {Function|string} pageFunction
     * @param {!Array<*>} args
     * @return {!Promise<(!Object|undefined)>}
     */
    async $$eval(selector, pageFunction, ...args) {
      return this._mainWorld.$$eval(selector, pageFunction, ...args);
    }
  
    /**
     * @param {string} selector
     * @return {!Promise<!Array<!Puppeteer.ElementHandle>>}
     */
    async $$(selector) {
      return this._mainWorld.$$(selector);
    }
  
    /**
     * @return {!Promise<String>}
     */
    async content() {
      return this._secondaryWorld.content();
    }
  
    /**
     * @param {string} html
     * @param {!{timeout?: number, waitUntil?: string|!Array<string>}=} options
     */
    async setContent(html, options = {}) {
      return this._secondaryWorld.setContent(html, options);
    }
  
    /**
     * @return {string}
     */
    name() {
      return this._name || '';
    }
  
    /**
     * @return {string}
     */
    url() {
      return this._url;
    }
  
    /**
     * @return {?Frame}
     */
    parentFrame() {
      return this._parentFrame;
    }
  
    /**
     * @return {!Array.<!Frame>}
     */
    childFrames() {
      return Array.from(this._childFrames);
    }
  
    /**
     * @return {boolean}
     */
    isDetached() {
      return this._detached;
    }
  
    /**
     * @param {!{url?: string, path?: string, content?: string, type?: string}} options
     * @return {!Promise<!Puppeteer.ElementHandle>}
     */
    async addScriptTag(options) {
      return this._mainWorld.addScriptTag(options);
    }
  
    /**
     * @param {!{url?: string, path?: string, content?: string}} options
     * @return {!Promise<!Puppeteer.ElementHandle>}
     */
    async addStyleTag(options) {
      return this._mainWorld.addStyleTag(options);
    }
  
    /**
     * @param {string} selector
     * @param {!{delay?: number, button?: "left"|"right"|"middle", clickCount?: number}=} options
     */
    async click(selector, options) {
      return this._secondaryWorld.click(selector, options);
    }
  
    /**
     * @param {string} selector
     */
    async focus(selector) {
      return this._secondaryWorld.focus(selector);
    }
  
    /**
     * @param {string} selector
     */
    async hover(selector) {
      return this._secondaryWorld.hover(selector);
    }
  
    /**
    * @param {string} selector
    * @param {!Array<string>} values
    * @return {!Promise<!Array<string>>}
    */
    select(selector, ...values){
      return this._secondaryWorld.select(selector, ...values);
    }
  
    /**
     * @param {string} selector
     */
    async tap(selector) {
      return this._secondaryWorld.tap(selector);
    }
  
    /**
     * @param {string} selector
     * @param {string} text
     * @param {{delay: (number|undefined)}=} options
     */
    async type(selector, text, options) {
      return this._mainWorld.type(selector, text, options);
    }
  
    /**
     * @param {(string|number|Function)} selectorOrFunctionOrTimeout
     * @param {!Object=} options
     * @param {!Array<*>} args
     * @return {!Promise<?Puppeteer.JSHandle>}
     */
    waitFor(selectorOrFunctionOrTimeout, options = {}, ...args) {
      const xPathPattern = '//';
  
      if (helper.isString(selectorOrFunctionOrTimeout)) {
        const string = /** @type {string} */ (selectorOrFunctionOrTimeout);
        if (string.startsWith(xPathPattern))
          return this.waitForXPath(string, options);
        return this.waitForSelector(string, options);
      }
      if (helper.isNumber(selectorOrFunctionOrTimeout))
        return new Promise(fulfill => setTimeout(fulfill, /** @type {number} */ (selectorOrFunctionOrTimeout)));
      if (typeof selectorOrFunctionOrTimeout === 'function')
        return this.waitForFunction(selectorOrFunctionOrTimeout, options, ...args);
      return Promise.reject(new Error('Unsupported target type: ' + (typeof selectorOrFunctionOrTimeout)));
    }
  
    /**
     * @param {string} selector
     * @param {!{visible?: boolean, hidden?: boolean, timeout?: number}=} options
     * @return {!Promise<?Puppeteer.ElementHandle>}
     */
    async waitForSelector(selector, options) {
      const handle = await this._secondaryWorld.waitForSelector(selector, options);
      if (!handle)
        return null;
      const mainExecutionContext = await this._mainWorld.executionContext();
      const result = await mainExecutionContext._adoptElementHandle(handle);
      await handle.dispose();
      return result;
    }
  
    /**
     * @param {string} xpath
     * @param {!{visible?: boolean, hidden?: boolean, timeout?: number}=} options
     * @return {!Promise<?Puppeteer.ElementHandle>}
     */
    async waitForXPath(xpath, options) {
      const handle = await this._secondaryWorld.waitForXPath(xpath, options);
      if (!handle)
        return null;
      const mainExecutionContext = await this._mainWorld.executionContext();
      const result = await mainExecutionContext._adoptElementHandle(handle);
      await handle.dispose();
      return result;
    }
  
    /**
     * @param {Function|string} pageFunction
     * @param {!{polling?: string|number, timeout?: number}=} options
     * @return {!Promise<!Puppeteer.JSHandle>}
     */
    waitForFunction(pageFunction, options = {}, ...args) {
      return this._mainWorld.waitForFunction(pageFunction, options, ...args);
    }
  
    /**
     * @return {!Promise<string>}
     */
    async title() {
      return this._secondaryWorld.title();
    }
  
    /**
     * @param {!Protocol.Page.Frame} framePayload
     */
    _navigated(framePayload) {
      this._name = framePayload.name;
      // TODO(lushnikov): remove this once requestInterception has loaderId exposed.
      this._navigationURL = framePayload.url;
      this._url = framePayload.url;
    }
  
    /**
     * @param {string} url
     */
    _navigatedWithinDocument(url) {
      this._url = url;
    }
  
    /**
     * @param {string} loaderId
     * @param {string} name
     */
    _onLifecycleEvent(loaderId, name) {
      if (name === 'init') {
        this._loaderId = loaderId;
        this._lifecycleEvents.clear();
      }
      this._lifecycleEvents.add(name);
    }
  
    _onLoadingStopped() {
      this._lifecycleEvents.add('DOMContentLoaded');
      this._lifecycleEvents.add('load');
    }
  
    _detach() {
      this._detached = true;
      this._mainWorld._detach();
      this._secondaryWorld._detach();
      if (this._parentFrame)
        this._parentFrame._childFrames.delete(this);
      this._parentFrame = null;
    }
  }
  
  function assertNoLegacyNavigationOptions(options) {
    assert(options['networkIdleTimeout'] === undefined, 'ERROR: networkIdleTimeout option is no longer supported.');
    assert(options['networkIdleInflight'] === undefined, 'ERROR: networkIdleInflight option is no longer supported.');
    assert(options.waitUntil !== 'networkidle', 'ERROR: "networkidle" option is no longer supported. Use "networkidle2" instead');
  }
  
  module.exports = {FrameManager, Frame};
  
  },{"./DOMWorld":45,"./Events":50,"./ExecutionContext":51,"./LifecycleWatcher":56,"./NetworkManager":57,"./helper":69,"events":5}],53:[function(require,module,exports){
  /**
   * Copyright 2017 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the 'License');
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an 'AS IS' BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  
  const {assert} = require('./helper');
  const keyDefinitions = require('./USKeyboardLayout');
  
  /**
   * @typedef {Object} KeyDescription
   * @property {number} keyCode
   * @property {string} key
   * @property {string} text
   * @property {string} code
   * @property {number} location
   */
  
  class Keyboard {
    /**
     * @param {!Puppeteer.CDPSession} client
     */
    constructor(client) {
      this._client = client;
      this._modifiers = 0;
      this._pressedKeys = new Set();
    }
  
    /**
     * @param {string} key
     * @param {{text?: string}=} options
     */
    async down(key, options = { text: undefined }) {
      const description = this._keyDescriptionForString(key);
  
      const autoRepeat = this._pressedKeys.has(description.code);
      this._pressedKeys.add(description.code);
      this._modifiers |= this._modifierBit(description.key);
  
      const text = options.text === undefined ? description.text : options.text;
      await this._client.send('Input.dispatchKeyEvent', {
        type: text ? 'keyDown' : 'rawKeyDown',
        modifiers: this._modifiers,
        windowsVirtualKeyCode: description.keyCode,
        code: description.code,
        key: description.key,
        text: text,
        unmodifiedText: text,
        autoRepeat,
        location: description.location,
        isKeypad: description.location === 3
      });
    }
  
    /**
     * @param {string} key
     * @return {number}
     */
    _modifierBit(key) {
      if (key === 'Alt')
        return 1;
      if (key === 'Control')
        return 2;
      if (key === 'Meta')
        return 4;
      if (key === 'Shift')
        return 8;
      return 0;
    }
  
    /**
     * @param {string} keyString
     * @return {KeyDescription}
     */
    _keyDescriptionForString(keyString) {
      const shift = this._modifiers & 8;
      const description = {
        key: '',
        keyCode: 0,
        code: '',
        text: '',
        location: 0
      };
  
      const definition = keyDefinitions[keyString];
      assert(definition, `Unknown key: "${keyString}"`);
  
      if (definition.key)
        description.key = definition.key;
      if (shift && definition.shiftKey)
        description.key = definition.shiftKey;
  
      if (definition.keyCode)
        description.keyCode = definition.keyCode;
      if (shift && definition.shiftKeyCode)
        description.keyCode = definition.shiftKeyCode;
  
      if (definition.code)
        description.code = definition.code;
  
      if (definition.location)
        description.location = definition.location;
  
      if (description.key.length === 1)
        description.text = description.key;
  
      if (definition.text)
        description.text = definition.text;
      if (shift && definition.shiftText)
        description.text = definition.shiftText;
  
      // if any modifiers besides shift are pressed, no text should be sent
      if (this._modifiers & ~8)
        description.text = '';
  
      return description;
    }
  
    /**
     * @param {string} key
     */
    async up(key) {
      const description = this._keyDescriptionForString(key);
  
      this._modifiers &= ~this._modifierBit(description.key);
      this._pressedKeys.delete(description.code);
      await this._client.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        modifiers: this._modifiers,
        key: description.key,
        windowsVirtualKeyCode: description.keyCode,
        code: description.code,
        location: description.location
      });
    }
  
    /**
     * @param {string} char
     */
    async sendCharacter(char) {
      await this._client.send('Input.insertText', {text: char});
    }
  
    /**
     * @param {string} text
     * @param {{delay: (number|undefined)}=} options
     */
    async type(text, options) {
      const delay = (options && options.delay) || null;
      for (const char of text) {
        if (keyDefinitions[char]) {
          await this.press(char, {delay});
        } else {
          if (delay)
            await new Promise(f => setTimeout(f, delay));
          await this.sendCharacter(char);
        }
      }
    }
  
    /**
     * @param {string} key
     * @param {!{delay?: number, text?: string}=} options
     */
    async press(key, options = {}) {
      const {delay = null} = options;
      await this.down(key, options);
      if (delay)
        await new Promise(f => setTimeout(f, options.delay));
      await this.up(key);
    }
  }
  
  class Mouse {
    /**
     * @param {Puppeteer.CDPSession} client
     * @param {!Keyboard} keyboard
     */
    constructor(client, keyboard) {
      this._client = client;
      this._keyboard = keyboard;
      this._x = 0;
      this._y = 0;
      /** @type {'none'|'left'|'right'|'middle'} */
      this._button = 'none';
    }
  
    /**
     * @param {number} x
     * @param {number} y
     * @param {!{steps?: number}=} options
     */
    async move(x, y, options = {}) {
      const {steps = 1} = options;
      const fromX = this._x, fromY = this._y;
      this._x = x;
      this._y = y;
      for (let i = 1; i <= steps; i++) {
        await this._client.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          button: this._button,
          x: fromX + (this._x - fromX) * (i / steps),
          y: fromY + (this._y - fromY) * (i / steps),
          modifiers: this._keyboard._modifiers
        });
      }
    }
  
    /**
     * @param {number} x
     * @param {number} y
     * @param {!{delay?: number, button?: "left"|"right"|"middle", clickCount?: number}=} options
     */
    async click(x, y, options = {}) {
      const {delay = null} = options;
      if (delay !== null) {
        await Promise.all([
          this.move(x, y),
          this.down(options),
        ]);
        await new Promise(f => setTimeout(f, delay));
        await this.up(options);
      } else {
        await Promise.all([
          this.move(x, y),
          this.down(options),
          this.up(options),
        ]);
      }
    }
  
    /**
     * @param {!{button?: "left"|"right"|"middle", clickCount?: number}=} options
     */
    async down(options = {}) {
      const {button = 'left', clickCount = 1} = options;
      this._button = button;
      await this._client.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        button,
        x: this._x,
        y: this._y,
        modifiers: this._keyboard._modifiers,
        clickCount
      });
    }
  
    /**
     * @param {!{button?: "left"|"right"|"middle", clickCount?: number}=} options
     */
    async up(options = {}) {
      const {button = 'left', clickCount = 1} = options;
      this._button = 'none';
      await this._client.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        button,
        x: this._x,
        y: this._y,
        modifiers: this._keyboard._modifiers,
        clickCount
      });
    }
  }
  
  class Touchscreen {
    /**
     * @param {Puppeteer.CDPSession} client
     * @param {Keyboard} keyboard
     */
    constructor(client, keyboard) {
      this._client = client;
      this._keyboard = keyboard;
    }
  
    /**
     * @param {number} x
     * @param {number} y
     */
    async tap(x, y) {
      // Touches appear to be lost during the first frame after navigation.
      // This waits a frame before sending the tap.
      // @see https://crbug.com/613219
      await this._client.send('Runtime.evaluate', {
        expression: 'new Promise(x => requestAnimationFrame(() => requestAnimationFrame(x)))',
        awaitPromise: true
      });
  
      const touchPoints = [{x: Math.round(x), y: Math.round(y)}];
      await this._client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints,
        modifiers: this._keyboard._modifiers
      });
      await this._client.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
        modifiers: this._keyboard._modifiers
      });
    }
  }
  
  module.exports = { Keyboard, Mouse, Touchscreen};
  
  },{"./USKeyboardLayout":65,"./helper":69}],54:[function(require,module,exports){
  /**
   * Copyright 2019 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  
  const {helper, assert, debugError} = require('./helper');
  
  function createJSHandle(context, remoteObject) {
    const frame = context.frame();
    if (remoteObject.subtype === 'node' && frame) {
      const frameManager = frame._frameManager;
      return new ElementHandle(context, context._client, remoteObject, frameManager.page(), frameManager);
    }
    return new JSHandle(context, context._client, remoteObject);
  }
  
  class JSHandle {
    /**
     * @param {!Puppeteer.ExecutionContext} context
     * @param {!Puppeteer.CDPSession} client
     * @param {!Protocol.Runtime.RemoteObject} remoteObject
     */
    constructor(context, client, remoteObject) {
      this._context = context;
      this._client = client;
      this._remoteObject = remoteObject;
      this._disposed = false;
    }
  
    /**
     * @return {!Puppeteer.ExecutionContext}
     */
    executionContext() {
      return this._context;
    }
  
    /**
     * @param {Function|String} pageFunction
     * @param {!Array<*>} args
     * @return {!Promise<(!Object|undefined)>}
     */
    async evaluate(pageFunction, ...args) {
      return await this.executionContext().evaluate(pageFunction, this, ...args);
    }
  
    /**
     * @param {Function|string} pageFunction
     * @param {!Array<*>} args
     * @return {!Promise<!Puppeteer.JSHandle>}
     */
    async evaluateHandle(pageFunction, ...args) {
      return await this.executionContext().evaluateHandle(pageFunction, this, ...args);
    }
  
    /**
     * @param {string} propertyName
     * @return {!Promise<?JSHandle>}
     */
    async getProperty(propertyName) {
      const objectHandle = await this.evaluateHandle((object, propertyName) => {
        const result = {__proto__: null};
        result[propertyName] = object[propertyName];
        return result;
      }, propertyName);
      const properties = await objectHandle.getProperties();
      const result = properties.get(propertyName) || null;
      await objectHandle.dispose();
      return result;
    }
  
    /**
     * @return {!Promise<!Map<string, !JSHandle>>}
     */
    async getProperties() {
      const response = await this._client.send('Runtime.getProperties', {
        objectId: this._remoteObject.objectId,
        ownProperties: true
      });
      const result = new Map();
      for (const property of response.result) {
        if (!property.enumerable)
          continue;
        result.set(property.name, createJSHandle(this._context, property.value));
      }
      return result;
    }
  
    /**
     * @return {!Promise<?Object>}
     */
    async jsonValue() {
      if (this._remoteObject.objectId) {
        const response = await this._client.send('Runtime.callFunctionOn', {
          functionDeclaration: 'function() { return this; }',
          objectId: this._remoteObject.objectId,
          returnByValue: true,
          awaitPromise: true,
        });
        return helper.valueFromRemoteObject(response.result);
      }
      return helper.valueFromRemoteObject(this._remoteObject);
    }
  
    /**
     * @return {?Puppeteer.ElementHandle}
     */
    asElement() {
      return null;
    }
  
    async dispose() {
      if (this._disposed)
        return;
      this._disposed = true;
      await helper.releaseObject(this._client, this._remoteObject);
    }
  
    /**
     * @override
     * @return {string}
     */
    toString() {
      if (this._remoteObject.objectId) {
        const type =  this._remoteObject.subtype || this._remoteObject.type;
        return 'JSHandle@' + type;
      }
      return 'JSHandle:' + helper.valueFromRemoteObject(this._remoteObject);
    }
  }
  
  class ElementHandle extends JSHandle {
    /**
     * @param {!Puppeteer.ExecutionContext} context
     * @param {!Puppeteer.CDPSession} client
     * @param {!Protocol.Runtime.RemoteObject} remoteObject
     * @param {!Puppeteer.Page} page
     * @param {!Puppeteer.FrameManager} frameManager
     */
    constructor(context, client, remoteObject, page, frameManager) {
      super(context, client, remoteObject);
      this._client = client;
      this._remoteObject = remoteObject;
      this._page = page;
      this._frameManager = frameManager;
      this._disposed = false;
    }
  
    /**
     * @override
     * @return {?ElementHandle}
     */
    asElement() {
      return this;
    }
  
    /**
     * @return {!Promise<?Puppeteer.Frame>}
     */
    async contentFrame() {
      const nodeInfo = await this._client.send('DOM.describeNode', {
        objectId: this._remoteObject.objectId
      });
      if (typeof nodeInfo.node.frameId !== 'string')
        return null;
      return this._frameManager.frame(nodeInfo.node.frameId);
    }
  
    async _scrollIntoViewIfNeeded() {
      const error = await this.evaluate(async(element, pageJavascriptEnabled) => {
        if (!element.isConnected)
          return 'Node is detached from document';
        if (element.nodeType !== Node.ELEMENT_NODE)
          return 'Node is not of type HTMLElement';
        // force-scroll if page's javascript is disabled.
        if (!pageJavascriptEnabled) {
          element.scrollIntoView({block: 'center', inline: 'center', behavior: 'instant'});
          return false;
        }
        const visibleRatio = await new Promise(resolve => {
          const observer = new IntersectionObserver(entries => {
            resolve(entries[0].intersectionRatio);
            observer.disconnect();
          });
          observer.observe(element);
        });
        if (visibleRatio !== 1.0)
          element.scrollIntoView({block: 'center', inline: 'center', behavior: 'instant'});
        return false;
      }, this._page._javascriptEnabled);
      if (error)
        throw new Error(error);
    }
  
    /**
     * @return {!Promise<!{x: number, y: number}>}
     */
    async _clickablePoint() {
      const [result, layoutMetrics] = await Promise.all([
        this._client.send('DOM.getContentQuads', {
          objectId: this._remoteObject.objectId
        }).catch(debugError),
        this._client.send('Page.getLayoutMetrics'),
      ]);
      if (!result || !result.quads.length)
        throw new Error('Node is either not visible or not an HTMLElement');
      // Filter out quads that have too small area to click into.
      const {clientWidth, clientHeight} = layoutMetrics.layoutViewport;
      const quads = result.quads.map(quad => this._fromProtocolQuad(quad)).map(quad => this._intersectQuadWithViewport(quad, clientWidth, clientHeight)).filter(quad => computeQuadArea(quad) > 1);
      if (!quads.length)
        throw new Error('Node is either not visible or not an HTMLElement');
      // Return the middle point of the first quad.
      const quad = quads[0];
      let x = 0;
      let y = 0;
      for (const point of quad) {
        x += point.x;
        y += point.y;
      }
      return {
        x: x / 4,
        y: y / 4
      };
    }
  
    /**
     * @return {!Promise<void|Protocol.DOM.getBoxModelReturnValue>}
     */
    _getBoxModel() {
      return this._client.send('DOM.getBoxModel', {
        objectId: this._remoteObject.objectId
      }).catch(error => debugError(error));
    }
  
    /**
     * @param {!Array<number>} quad
     * @return {!Array<{x: number, y: number}>}
     */
    _fromProtocolQuad(quad) {
      return [
        {x: quad[0], y: quad[1]},
        {x: quad[2], y: quad[3]},
        {x: quad[4], y: quad[5]},
        {x: quad[6], y: quad[7]}
      ];
    }
  
    /**
     * @param {!Array<{x: number, y: number}>} quad
     * @param {number} width
     * @param {number} height
     * @return {!Array<{x: number, y: number}>}
     */
    _intersectQuadWithViewport(quad, width, height) {
      return quad.map(point => ({
        x: Math.min(Math.max(point.x, 0), width),
        y: Math.min(Math.max(point.y, 0), height),
      }));
    }
  
    async hover() {
      await this._scrollIntoViewIfNeeded();
      const {x, y} = await this._clickablePoint();
      await this._page.mouse.move(x, y);
    }
  
    /**
     * @param {!{delay?: number, button?: "left"|"right"|"middle", clickCount?: number}=} options
     */
    async click(options) {
      await this._scrollIntoViewIfNeeded();
      const {x, y} = await this._clickablePoint();
      await this._page.mouse.click(x, y, options);
    }
  
    /**
     * @param {!Array<string>} values
     * @return {!Promise<!Array<string>>}
     */
    async select(...values) {
      for (const value of values)
        assert(helper.isString(value), 'Values must be strings. Found value "' + value + '" of type "' + (typeof value) + '"');
      return this.evaluate((element, values) => {
        if (element.nodeName.toLowerCase() !== 'select')
          throw new Error('Element is not a <select> element.');
  
        const options = Array.from(element.options);
        element.value = undefined;
        for (const option of options) {
          option.selected = values.includes(option.value);
          if (option.selected && !element.multiple)
            break;
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return options.filter(option => option.selected).map(option => option.value);
      }, values);
    }
  
    /**
     * @param {!Array<string>} filePaths
     */
    async uploadFile(...filePaths) {
      const isMultiple = await this.evaluate(element => element.multiple);
      assert(filePaths.length <= 1 || isMultiple, 'Multiple file uploads only work with <input type=file multiple>');
      // These imports are only needed for `uploadFile`, so keep them
      // scoped here to avoid paying the cost unnecessarily.
      const path = require('path');
      const mime = require('mime-types');
      const fs = require('fs');
      const readFileAsync = helper.promisify(fs.readFile);
  
      const promises = filePaths.map(filePath => readFileAsync(filePath));
      const files = [];
      for (let i = 0; i < filePaths.length; i++) {
        const buffer = await promises[i];
        const filePath = path.basename(filePaths[i]);
        const file = {
          name: filePath,
          content: buffer.toString('base64'),
          mimeType: mime.lookup(filePath),
        };
        files.push(file);
      }
      await this.evaluateHandle(async(element, files) => {
        const dt = new DataTransfer();
        for (const item of files) {
          const response = await fetch(`data:${item.mimeType};base64,${item.content}`);
          const file = new File([await response.blob()], item.name);
          dt.items.add(file);
        }
        element.files = dt.files;
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }, files);
    }
  
    async tap() {
      await this._scrollIntoViewIfNeeded();
      const {x, y} = await this._clickablePoint();
      await this._page.touchscreen.tap(x, y);
    }
  
    async focus() {
      await this.evaluate(element => element.focus());
    }
  
    /**
     * @param {string} text
     * @param {{delay: (number|undefined)}=} options
     */
    async type(text, options) {
      await this.focus();
      await this._page.keyboard.type(text, options);
    }
  
    /**
     * @param {string} key
     * @param {!{delay?: number, text?: string}=} options
     */
    async press(key, options) {
      await this.focus();
      await this._page.keyboard.press(key, options);
    }
  
    /**
     * @return {!Promise<?{x: number, y: number, width: number, height: number}>}
     */
    async boundingBox() {
      const result = await this._getBoxModel();
  
      if (!result)
        return null;
  
      const quad = result.model.border;
      const x = Math.min(quad[0], quad[2], quad[4], quad[6]);
      const y = Math.min(quad[1], quad[3], quad[5], quad[7]);
      const width = Math.max(quad[0], quad[2], quad[4], quad[6]) - x;
      const height = Math.max(quad[1], quad[3], quad[5], quad[7]) - y;
  
      return {x, y, width, height};
    }
  
    /**
     * @return {!Promise<?BoxModel>}
     */
    async boxModel() {
      const result = await this._getBoxModel();
  
      if (!result)
        return null;
  
      const {content, padding, border, margin, width, height} = result.model;
      return {
        content: this._fromProtocolQuad(content),
        padding: this._fromProtocolQuad(padding),
        border: this._fromProtocolQuad(border),
        margin: this._fromProtocolQuad(margin),
        width,
        height
      };
    }
  
    /**
     *
     * @param {!Object=} options
     * @returns {!Promise<string|!Buffer>}
     */
    async screenshot(options = {}) {
      let needsViewportReset = false;
  
      let boundingBox = await this.boundingBox();
      assert(boundingBox, 'Node is either not visible or not an HTMLElement');
  
      const viewport = this._page.viewport();
  
      if (viewport && (boundingBox.width > viewport.width || boundingBox.height > viewport.height)) {
        const newViewport = {
          width: Math.max(viewport.width, Math.ceil(boundingBox.width)),
          height: Math.max(viewport.height, Math.ceil(boundingBox.height)),
        };
        await this._page.setViewport(Object.assign({}, viewport, newViewport));
  
        needsViewportReset = true;
      }
  
      await this._scrollIntoViewIfNeeded();
  
      boundingBox = await this.boundingBox();
      assert(boundingBox, 'Node is either not visible or not an HTMLElement');
      assert(boundingBox.width !== 0, 'Node has 0 width.');
      assert(boundingBox.height !== 0, 'Node has 0 height.');
  
      const { layoutViewport: { pageX, pageY } } = await this._client.send('Page.getLayoutMetrics');
  
      const clip = Object.assign({}, boundingBox);
      clip.x += pageX;
      clip.y += pageY;
  
      const imageData = await this._page.screenshot(Object.assign({}, {
        clip
      }, options));
  
      if (needsViewportReset)
        await this._page.setViewport(viewport);
  
      return imageData;
    }
  
    /**
     * @param {string} selector
     * @return {!Promise<?ElementHandle>}
     */
    async $(selector) {
      const handle = await this.evaluateHandle(
          (element, selector) => element.querySelector(selector),
          selector
      );
      const element = handle.asElement();
      if (element)
        return element;
      await handle.dispose();
      return null;
    }
  
    /**
     * @param {string} selector
     * @return {!Promise<!Array<!ElementHandle>>}
     */
    async $$(selector) {
      const arrayHandle = await this.evaluateHandle(
          (element, selector) => element.querySelectorAll(selector),
          selector
      );
      const properties = await arrayHandle.getProperties();
      await arrayHandle.dispose();
      const result = [];
      for (const property of properties.values()) {
        const elementHandle = property.asElement();
        if (elementHandle)
          result.push(elementHandle);
      }
      return result;
    }
  
    /**
     * @param {string} selector
     * @param {Function|String} pageFunction
     * @param {!Array<*>} args
     * @return {!Promise<(!Object|undefined)>}
     */
    async $eval(selector, pageFunction, ...args) {
      const elementHandle = await this.$(selector);
      if (!elementHandle)
        throw new Error(`Error: failed to find element matching selector "${selector}"`);
      const result = await elementHandle.evaluate(pageFunction, ...args);
      await elementHandle.dispose();
      return result;
    }
  
    /**
     * @param {string} selector
     * @param {Function|String} pageFunction
     * @param {!Array<*>} args
     * @return {!Promise<(!Object|undefined)>}
     */
    async $$eval(selector, pageFunction, ...args) {
      const arrayHandle = await this.evaluateHandle(
          (element, selector) => Array.from(element.querySelectorAll(selector)),
          selector
      );
  
      const result = await arrayHandle.evaluate(pageFunction, ...args);
      await arrayHandle.dispose();
      return result;
    }
  
    /**
     * @param {string} expression
     * @return {!Promise<!Array<!ElementHandle>>}
     */
    async $x(expression) {
      const arrayHandle = await this.evaluateHandle(
          (element, expression) => {
            const document = element.ownerDocument || element;
            const iterator = document.evaluate(expression, element, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE);
            const array = [];
            let item;
            while ((item = iterator.iterateNext()))
              array.push(item);
            return array;
          },
          expression
      );
      const properties = await arrayHandle.getProperties();
      await arrayHandle.dispose();
      const result = [];
      for (const property of properties.values()) {
        const elementHandle = property.asElement();
        if (elementHandle)
          result.push(elementHandle);
      }
      return result;
    }
  
    /**
     * @returns {!Promise<boolean>}
     */
    isIntersectingViewport() {
      return this.evaluate(async element => {
        const visibleRatio = await new Promise(resolve => {
          const observer = new IntersectionObserver(entries => {
            resolve(entries[0].intersectionRatio);
            observer.disconnect();
          });
          observer.observe(element);
        });
        return visibleRatio > 0;
      });
    }
  }
  
  function computeQuadArea(quad) {
    // Compute sum of all directed areas of adjacent triangles
    // https://en.wikipedia.org/wiki/Polygon#Simple_polygons
    let area = 0;
    for (let i = 0; i < quad.length; ++i) {
      const p1 = quad[i];
      const p2 = quad[(i + 1) % quad.length];
      area += (p1.x * p2.y - p2.x * p1.y) / 2;
    }
    return Math.abs(area);
  }
  
  /**
   * @typedef {Object} BoxModel
   * @property {!Array<!{x: number, y: number}>} content
   * @property {!Array<!{x: number, y: number}>} padding
   * @property {!Array<!{x: number, y: number}>} border
   * @property {!Array<!{x: number, y: number}>} margin
   * @property {number} width
   * @property {number} height
   */
  
  module.exports = {createJSHandle, JSHandle, ElementHandle};
  
  },{"./helper":69,"fs":2,"mime-types":74,"path":10}],55:[function(require,module,exports){
  (function (process){(function (){
  /**
   * Copyright 2017 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  const os = require('os');
  const path = require('path');
  const http = require('http');
  const https = require('https');
  const URL = require('url');
  const removeFolder = require('rimraf');
  const childProcess = require('child_process');
  const BrowserFetcher = require('./BrowserFetcher');
  const {Connection} = require('./Connection');
  const {Browser} = require('./Browser');
  const readline = require('readline');
  const fs = require('fs');
  const {helper, assert, debugError} = require('./helper');
  const debugLauncher = require('debug')(`puppeteer:launcher`);
  const {TimeoutError} = require('./Errors');
  const WebSocketTransport = require('./WebSocketTransport');
  const PipeTransport = require('./PipeTransport');
  
  const mkdtempAsync = helper.promisify(fs.mkdtemp);
  const removeFolderAsync = helper.promisify(removeFolder);
  const writeFileAsync = helper.promisify(fs.writeFile);
  
  class BrowserRunner {
  
    /**
     * @param {string} executablePath
     * @param {!Array<string>} processArguments
     * @param {string=} tempDirectory
     */
    constructor(executablePath, processArguments, tempDirectory) {
      this._executablePath = executablePath;
      this._processArguments = processArguments;
      this._tempDirectory = tempDirectory;
      this.proc = null;
      this.connection = null;
      this._closed = true;
      this._listeners = [];
    }
  
    /**
     * @param {!(Launcher.LaunchOptions)=} options
     */
    start(options = {}) {
      const {
        handleSIGINT,
        handleSIGTERM,
        handleSIGHUP,
        dumpio,
        env,
        pipe
      } = options;
      /** @type {!Array<"ignore"|"pipe">} */
      let stdio = ['pipe', 'pipe', 'pipe'];
      if (pipe) {
        if (dumpio)
          stdio = ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'];
        else
          stdio = ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'];
      }
      assert(!this.proc, 'This process has previously been started.');
      debugLauncher(`Calling ${this._executablePath} ${this._processArguments.join(' ')}`);
      this.proc = childProcess.spawn(
          this._executablePath,
          this._processArguments,
          {
            // On non-windows platforms, `detached: true` makes child process a leader of a new
            // process group, making it possible to kill child process tree with `.kill(-pid)` command.
            // @see https://nodejs.org/api/child_process.html#child_process_options_detached
            detached: process.platform !== 'win32',
            env,
            stdio
          }
      );
      if (dumpio) {
        this.proc.stderr.pipe(process.stderr);
        this.proc.stdout.pipe(process.stdout);
      }
      this._closed = false;
      this._processClosing = new Promise((fulfill, reject) => {
        this.proc.once('exit', () => {
          this._closed = true;
          // Cleanup as processes exit.
          if (this._tempDirectory) {
            removeFolderAsync(this._tempDirectory)
                .then(() => fulfill())
                .catch(err => console.error(err));
          } else {
            fulfill();
          }
        });
      });
      this._listeners = [ helper.addEventListener(process, 'exit', this.kill.bind(this)) ];
      if (handleSIGINT)
        this._listeners.push(helper.addEventListener(process, 'SIGINT', () => { this.kill(); process.exit(130); }));
      if (handleSIGTERM)
        this._listeners.push(helper.addEventListener(process, 'SIGTERM', this.close.bind(this)));
      if (handleSIGHUP)
        this._listeners.push(helper.addEventListener(process, 'SIGHUP', this.close.bind(this)));
    }
  
    /**
     * @return {Promise}
     */
    close() {
      if (this._closed)
        return Promise.resolve();
      helper.removeEventListeners(this._listeners);
      if (this._tempDirectory) {
        this.kill();
      } else if (this.connection) {
        // Attempt to close the browser gracefully
        this.connection.send('Browser.close').catch(error => {
          debugError(error);
          this.kill();
        });
      }
      return this._processClosing;
    }
  
    // This function has to be sync to be used as 'exit' event handler.
    kill() {
      helper.removeEventListeners(this._listeners);
      if (this.proc && this.proc.pid && !this.proc.killed && !this._closed) {
        try {
          if (process.platform === 'win32')
            childProcess.execSync(`taskkill /pid ${this.proc.pid} /T /F`);
          else
            process.kill(-this.proc.pid, 'SIGKILL');
        } catch (error) {
          // the process might have already stopped
        }
      }
      // Attempt to remove temporary profile directory to avoid littering.
      try {
        removeFolder.sync(this._tempDirectory);
      } catch (error) { }
    }
  
    /**
     * @param {!({usePipe?: boolean, timeout: number, slowMo: number, preferredRevision: string})} options
     *
     * @return {!Promise<!Connection>}
     */
    async setupConnection(options) {
      const {
        usePipe,
        timeout,
        slowMo,
        preferredRevision
      } = options;
      if (!usePipe) {
        const browserWSEndpoint = await waitForWSEndpoint(this.proc, timeout, preferredRevision);
        const transport = await WebSocketTransport.create(browserWSEndpoint);
        this.connection = new Connection(browserWSEndpoint, transport, slowMo);
      } else {
        const transport = new PipeTransport(/** @type {!NodeJS.WritableStream} */(this.proc.stdio[3]), /** @type {!NodeJS.ReadableStream} */ (this.proc.stdio[4]));
        this.connection = new Connection('', transport, slowMo);
      }
      return this.connection;
    }
  }
  
  /**
   * @implements {!Puppeteer.ProductLauncher}
   */
  class ChromeLauncher {
    /**
     * @param {string} projectRoot
     * @param {string} preferredRevision
     * @param {boolean} isPuppeteerCore
     */
    constructor(projectRoot, preferredRevision, isPuppeteerCore) {
      this._projectRoot = projectRoot;
      this._preferredRevision = preferredRevision;
      this._isPuppeteerCore = isPuppeteerCore;
    }
  
    /**
     * @param {!(Launcher.LaunchOptions & Launcher.ChromeArgOptions & Launcher.BrowserOptions)=} options
     * @return {!Promise<!Browser>}
     */
    async launch(options = {}) {
      const {
        ignoreDefaultArgs = false,
        args = [],
        dumpio = false,
        executablePath = null,
        pipe = false,
        env = process.env,
        handleSIGINT = true,
        handleSIGTERM = true,
        handleSIGHUP = true,
        ignoreHTTPSErrors = false,
        defaultViewport = {width: 800, height: 600},
        slowMo = 0,
        timeout = 30000
      } = options;
  
      const profilePath = path.join(os.tmpdir(), 'puppeteer_dev_chrome_profile-');
      const chromeArguments = [];
      if (!ignoreDefaultArgs)
        chromeArguments.push(...this.defaultArgs(options));
      else if (Array.isArray(ignoreDefaultArgs))
        chromeArguments.push(...this.defaultArgs(options).filter(arg => !ignoreDefaultArgs.includes(arg)));
      else
        chromeArguments.push(...args);
  
      let temporaryUserDataDir = null;
  
      if (!chromeArguments.some(argument => argument.startsWith('--remote-debugging-')))
        chromeArguments.push(pipe ? '--remote-debugging-pipe' : '--remote-debugging-port=0');
      if (!chromeArguments.some(arg => arg.startsWith('--user-data-dir'))) {
        temporaryUserDataDir = await mkdtempAsync(profilePath);
        chromeArguments.push(`--user-data-dir=${temporaryUserDataDir}`);
      }
  
      let chromeExecutable = executablePath;
      if (!executablePath) {
        const {missingText, executablePath} = resolveExecutablePath(this);
        if (missingText)
          throw new Error(missingText);
        chromeExecutable = executablePath;
      }
  
      const usePipe = chromeArguments.includes('--remote-debugging-pipe');
      const runner = new BrowserRunner(chromeExecutable, chromeArguments, temporaryUserDataDir);
      runner.start({handleSIGHUP, handleSIGTERM, handleSIGINT, dumpio, env, pipe: usePipe});
  
      try {
        const connection = await runner.setupConnection({usePipe, timeout, slowMo, preferredRevision: this._preferredRevision});
        const browser = await Browser.create(connection, [], ignoreHTTPSErrors, defaultViewport, runner.proc, runner.close.bind(runner));
        await browser.waitForTarget(t => t.type() === 'page');
        return browser;
      } catch (error) {
        runner.kill();
        throw error;
      }
    }
  
    /**
     * @param {!Launcher.ChromeArgOptions=} options
     * @return {!Array<string>}
     */
    defaultArgs(options = {}) {
      const chromeArguments = [
        '--disable-background-networking',
        '--enable-features=NetworkService,NetworkServiceInProcess',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-client-side-phishing-detection',
        '--disable-component-extensions-with-background-pages',
        '--disable-default-apps',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--disable-features=TranslateUI',
        '--disable-hang-monitor',
        '--disable-ipc-flooding-protection',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-renderer-backgrounding',
        '--disable-sync',
        '--force-color-profile=srgb',
        '--metrics-recording-only',
        '--no-first-run',
        '--enable-automation',
        '--password-store=basic',
        '--use-mock-keychain',
      ];
      const {
        devtools = false,
        headless = !devtools,
        args = [],
        userDataDir = null
      } = options;
      if (userDataDir)
        chromeArguments.push(`--user-data-dir=${userDataDir}`);
      if (devtools)
        chromeArguments.push('--auto-open-devtools-for-tabs');
      if (headless) {
        chromeArguments.push(
            '--headless',
            '--hide-scrollbars',
            '--mute-audio'
        );
      }
      if (args.every(arg => arg.startsWith('-')))
        chromeArguments.push('about:blank');
      chromeArguments.push(...args);
      return chromeArguments;
    }
  
    /**
     * @return {string}
     */
    executablePath() {
      return resolveExecutablePath(this).executablePath;
    }
  
    /**
    * @return {string}
    */
    get product() {
      return 'chrome';
    }
  
    /**
     * @param {!(Launcher.BrowserOptions & {browserWSEndpoint?: string, browserURL?: string, transport?: !Puppeteer.ConnectionTransport})} options
     * @return {!Promise<!Browser>}
     */
    async connect(options) {
      const {
        browserWSEndpoint,
        browserURL,
        ignoreHTTPSErrors = false,
        defaultViewport = {width: 800, height: 600},
        transport,
        slowMo = 0,
      } = options;
  
      assert(Number(!!browserWSEndpoint) + Number(!!browserURL) + Number(!!transport) === 1, 'Exactly one of browserWSEndpoint, browserURL or transport must be passed to puppeteer.connect');
  
      let connection = null;
      if (transport) {
        connection = new Connection('', transport, slowMo);
      } else if (browserWSEndpoint) {
        const connectionTransport = await WebSocketTransport.create(browserWSEndpoint);
        connection = new Connection(browserWSEndpoint, connectionTransport, slowMo);
      } else if (browserURL) {
        const connectionURL = await getWSEndpoint(browserURL);
        const connectionTransport = await WebSocketTransport.create(connectionURL);
        connection = new Connection(connectionURL, connectionTransport, slowMo);
      }
  
      const {browserContextIds} = await connection.send('Target.getBrowserContexts');
      return Browser.create(connection, browserContextIds, ignoreHTTPSErrors, defaultViewport, null, () => connection.send('Browser.close').catch(debugError));
    }
  
  }
  
  /**
   * @implements {!Puppeteer.ProductLauncher}
   */
  class FirefoxLauncher {
    /**
     * @param {string} projectRoot
     * @param {string} preferredRevision
     * @param {boolean} isPuppeteerCore
     */
    constructor(projectRoot, preferredRevision, isPuppeteerCore) {
      this._projectRoot = projectRoot;
      this._preferredRevision = preferredRevision;
      this._isPuppeteerCore = isPuppeteerCore;
    }
  
    /**
     * @param {!(Launcher.LaunchOptions & Launcher.ChromeArgOptions & Launcher.BrowserOptions & {extraPrefsFirefox?: !object})=} options
     * @return {!Promise<!Browser>}
     */
    async launch(options = {}) {
      const {
        ignoreDefaultArgs = false,
        args = [],
        dumpio = false,
        executablePath = null,
        pipe = false,
        env = process.env,
        handleSIGINT = true,
        handleSIGTERM = true,
        handleSIGHUP = true,
        ignoreHTTPSErrors = false,
        defaultViewport = {width: 800, height: 600},
        slowMo = 0,
        timeout = 30000,
        extraPrefsFirefox = {}
      } = options;
  
      const firefoxArguments = [];
      if (!ignoreDefaultArgs)
        firefoxArguments.push(...this.defaultArgs(options));
      else if (Array.isArray(ignoreDefaultArgs))
        firefoxArguments.push(...this.defaultArgs(options).filter(arg => !ignoreDefaultArgs.includes(arg)));
      else
        firefoxArguments.push(...args);
  
      let temporaryUserDataDir = null;
  
      if (!firefoxArguments.includes('-profile') && !firefoxArguments.includes('--profile')) {
        temporaryUserDataDir = await this._createProfile(extraPrefsFirefox);
        firefoxArguments.push('--profile');
        firefoxArguments.push(temporaryUserDataDir);
      }
  
      let executable = executablePath;
      if (!executablePath) {
        const {missingText, executablePath} = resolveExecutablePath(this);
        if (missingText)
          throw new Error(missingText);
        executable = executablePath;
      }
  
      const runner = new BrowserRunner(executable, firefoxArguments, temporaryUserDataDir);
      runner.start({handleSIGHUP, handleSIGTERM, handleSIGINT, dumpio, env, pipe});
  
      try {
        const connection = await runner.setupConnection({usePipe: pipe, timeout, slowMo, preferredRevision: this._preferredRevision});
        const browser = await Browser.create(connection, [], ignoreHTTPSErrors, defaultViewport, runner.proc, runner.close.bind(runner));
        await browser.waitForTarget(t => t.type() === 'page');
        return browser;
      } catch (error) {
        runner.kill();
        throw error;
      }
    }
  
    /**
     * @param {!(Launcher.BrowserOptions & {browserWSEndpoint?: string, browserURL?: string, transport?: !Puppeteer.ConnectionTransport})} options
     * @return {!Promise<!Browser>}
     */
    async connect(options) {
      const {
        browserWSEndpoint,
        browserURL,
        ignoreHTTPSErrors = false,
        defaultViewport = {width: 800, height: 600},
        transport,
        slowMo = 0,
      } = options;
  
      assert(Number(!!browserWSEndpoint) + Number(!!browserURL) + Number(!!transport) === 1, 'Exactly one of browserWSEndpoint, browserURL or transport must be passed to puppeteer.connect');
  
      let connection = null;
      if (transport) {
        connection = new Connection('', transport, slowMo);
      } else if (browserWSEndpoint) {
        const connectionTransport = await WebSocketTransport.create(browserWSEndpoint);
        connection = new Connection(browserWSEndpoint, connectionTransport, slowMo);
      } else if (browserURL) {
        const connectionURL = await getWSEndpoint(browserURL);
        const connectionTransport = await WebSocketTransport.create(connectionURL);
        connection = new Connection(connectionURL, connectionTransport, slowMo);
      }
  
      const {browserContextIds} = await connection.send('Target.getBrowserContexts');
      return Browser.create(connection, browserContextIds, ignoreHTTPSErrors, defaultViewport, null, () => connection.send('Browser.close').catch(debugError));
    }
  
    /**
     * @return {string}
     */
    executablePath() {
      const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.npm_config_puppeteer_executable_path || process.env.npm_package_config_puppeteer_executable_path;
      // TODO get resolveExecutablePath working for Firefox
      if (!executablePath)
        throw new Error('Please set PUPPETEER_EXECUTABLE_PATH to a Firefox binary.');
      return executablePath;
    }
  
    /**
     * @return {string}
     */
    get product() {
      return 'firefox';
    }
  
    /**
     * @param {!Launcher.ChromeArgOptions=} options
     * @return {!Array<string>}
     */
    defaultArgs(options = {}) {
      const firefoxArguments = [
        '--remote-debugging-port=0',
        '--no-remote',
        '--foreground',
      ];
      const {
        devtools = false,
        headless = !devtools,
        args = [],
        userDataDir = null
      } = options;
      if (userDataDir) {
        firefoxArguments.push('--profile');
        firefoxArguments.push(userDataDir);
      }
      if (headless)
        firefoxArguments.push('--headless');
      if (devtools)
        firefoxArguments.push('--devtools');
      if (args.every(arg => arg.startsWith('-')))
        firefoxArguments.push('about:blank');
      firefoxArguments.push(...args);
      return firefoxArguments;
    }
  
    /**
     * @param {!Object=} extraPrefs
     * @return {!Promise<string>}
     */
    async _createProfile(extraPrefs) {
      const profilePath = await mkdtempAsync(path.join(os.tmpdir(), 'puppeteer_dev_firefox_profile-'));
      const prefsJS = [];
      const userJS = [];
      const server = 'dummy.test';
      const defaultPreferences = {
        // Make sure Shield doesn't hit the network.
        'app.normandy.api_url': '',
        // Disable Firefox old build background check
        'app.update.checkInstallTime': false,
        // Disable automatically upgrading Firefox
        'app.update.disabledForTesting': true,
  
        // Increase the APZ content response timeout to 1 minute
        'apz.content_response_timeout': 60000,
  
        // Prevent various error message on the console
        // jest-puppeteer asserts that no error message is emitted by the console
        'browser.contentblocking.features.standard': '-tp,tpPrivate,cookieBehavior0,-cm,-fp',
  
  
        // Enable the dump function: which sends messages to the system
        // console
        // https://bugzilla.mozilla.org/show_bug.cgi?id=1543115
        'browser.dom.window.dump.enabled': true,
        // Disable topstories
        'browser.newtabpage.activity-stream.feeds.section.topstories': false,
        // Always display a blank page
        'browser.newtabpage.enabled': false,
        // Background thumbnails in particular cause grief: and disabling
        // thumbnails in general cannot hurt
        'browser.pagethumbnails.capturing_disabled': true,
  
        // Disable safebrowsing components.
        'browser.safebrowsing.blockedURIs.enabled': false,
        'browser.safebrowsing.downloads.enabled': false,
        'browser.safebrowsing.malware.enabled': false,
        'browser.safebrowsing.passwords.enabled': false,
        'browser.safebrowsing.phishing.enabled': false,
  
        // Disable updates to search engines.
        'browser.search.update': false,
        // Do not restore the last open set of tabs if the browser has crashed
        'browser.sessionstore.resume_from_crash': false,
        // Skip check for default browser on startup
        'browser.shell.checkDefaultBrowser': false,
  
        // Disable newtabpage
        'browser.startup.homepage': 'about:blank',
        // Do not redirect user when a milstone upgrade of Firefox is detected
        'browser.startup.homepage_override.mstone': 'ignore',
        // Start with a blank page about:blank
        'browser.startup.page': 0,
  
        // Do not allow background tabs to be zombified on Android: otherwise for
        // tests that open additional tabs: the test harness tab itself might get
        // unloaded
        'browser.tabs.disableBackgroundZombification': false,
        // Do not warn when closing all other open tabs
        'browser.tabs.warnOnCloseOtherTabs': false,
        // Do not warn when multiple tabs will be opened
        'browser.tabs.warnOnOpen': false,
  
        // Disable the UI tour.
        'browser.uitour.enabled': false,
        // Turn off search suggestions in the location bar so as not to trigger
        // network connections.
        'browser.urlbar.suggest.searches': false,
        // Disable first run splash page on Windows 10
        'browser.usedOnWindows10.introURL': '',
        // Do not warn on quitting Firefox
        'browser.warnOnQuit': false,
  
        // Do not show datareporting policy notifications which can
        // interfere with tests
        'datareporting.healthreport.about.reportUrl': `http://${server}/dummy/abouthealthreport/`,
        'datareporting.healthreport.documentServerURI': `http://${server}/dummy/healthreport/`,
        'datareporting.healthreport.logging.consoleEnabled': false,
        'datareporting.healthreport.service.enabled': false,
        'datareporting.healthreport.service.firstRun': false,
        'datareporting.healthreport.uploadEnabled': false,
        'datareporting.policy.dataSubmissionEnabled': false,
        'datareporting.policy.dataSubmissionPolicyAccepted': false,
        'datareporting.policy.dataSubmissionPolicyBypassNotification': true,
  
        // DevTools JSONViewer sometimes fails to load dependencies with its require.js.
        // This doesn't affect Puppeteer but spams console (Bug 1424372)
        'devtools.jsonview.enabled': false,
  
        // Disable popup-blocker
        'dom.disable_open_during_load': false,
  
        // Enable the support for File object creation in the content process
        // Required for |Page.setFileInputFiles| protocol method.
        'dom.file.createInChild': true,
  
        // Disable the ProcessHangMonitor
        'dom.ipc.reportProcessHangs': false,
  
        // Disable slow script dialogues
        'dom.max_chrome_script_run_time': 0,
        'dom.max_script_run_time': 0,
  
        // Only load extensions from the application and user profile
        // AddonManager.SCOPE_PROFILE + AddonManager.SCOPE_APPLICATION
        'extensions.autoDisableScopes': 0,
        'extensions.enabledScopes': 5,
  
        // Disable metadata caching for installed add-ons by default
        'extensions.getAddons.cache.enabled': false,
  
        // Disable installing any distribution extensions or add-ons.
        'extensions.installDistroAddons': false,
  
        // Disabled screenshots extension
        'extensions.screenshots.disabled': true,
  
        // Turn off extension updates so they do not bother tests
        'extensions.update.enabled': false,
  
        // Turn off extension updates so they do not bother tests
        'extensions.update.notifyUser': false,
  
        // Make sure opening about:addons will not hit the network
        'extensions.webservice.discoverURL': `http://${server}/dummy/discoveryURL`,
  
        // Allow the application to have focus even it runs in the background
        'focusmanager.testmode': true,
        // Disable useragent updates
        'general.useragent.updates.enabled': false,
        // Always use network provider for geolocation tests so we bypass the
        // macOS dialog raised by the corelocation provider
        'geo.provider.testing': true,
        // Do not scan Wifi
        'geo.wifi.scan': false,
        // No hang monitor
        'hangmonitor.timeout': 0,
        // Show chrome errors and warnings in the error console
        'javascript.options.showInConsole': true,
  
        // Disable download and usage of OpenH264: and Widevine plugins
        'media.gmp-manager.updateEnabled': false,
        // Prevent various error message on the console
        // jest-puppeteer asserts that no error message is emitted by the console
        'network.cookie.cookieBehavior': 0,
  
        // Do not prompt for temporary redirects
        'network.http.prompt-temp-redirect': false,
  
        // Disable speculative connections so they are not reported as leaking
        // when they are hanging around
        'network.http.speculative-parallel-limit': 0,
  
        // Do not automatically switch between offline and online
        'network.manage-offline-status': false,
  
        // Make sure SNTP requests do not hit the network
        'network.sntp.pools': server,
  
        // Disable Flash.
        'plugin.state.flash': 0,
  
        'privacy.trackingprotection.enabled': false,
  
        // Enable Remote Agent
        // https://bugzilla.mozilla.org/show_bug.cgi?id=1544393
        'remote.enabled': true,
  
        // Don't do network connections for mitm priming
        'security.certerrors.mitm.priming.enabled': false,
        // Local documents have access to all other local documents,
        // including directory listings
        'security.fileuri.strict_origin_policy': false,
        // Do not wait for the notification button security delay
        'security.notification_enable_delay': 0,
  
        // Ensure blocklist updates do not hit the network
        'services.settings.server': `http://${server}/dummy/blocklist/`,
  
        // Do not automatically fill sign-in forms with known usernames and
        // passwords
        'signon.autofillForms': false,
        // Disable password capture, so that tests that include forms are not
        // influenced by the presence of the persistent doorhanger notification
        'signon.rememberSignons': false,
  
        // Disable first-run welcome page
        'startup.homepage_welcome_url': 'about:blank',
  
        // Disable first-run welcome page
        'startup.homepage_welcome_url.additional': '',
  
        // Disable browser animations (tabs, fullscreen, sliding alerts)
        'toolkit.cosmeticAnimations.enabled': false,
  
        // We want to collect telemetry, but we don't want to send in the results
        'toolkit.telemetry.server': `https://${server}/dummy/telemetry/`,
        // Prevent starting into safe mode after application crashes
        'toolkit.startup.max_resumed_crashes': -1,
  
      };
  
      Object.assign(defaultPreferences, extraPrefs);
      for (const [key, value] of Object.entries(defaultPreferences))
        userJS.push(`user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`);
      await writeFileAsync(path.join(profilePath, 'user.js'), userJS.join('\n'));
      await writeFileAsync(path.join(profilePath, 'prefs.js'), prefsJS.join('\n'));
      return profilePath;
    }
  }
  
  
  /**
   * @param {!Puppeteer.ChildProcess} browserProcess
   * @param {number} timeout
   * @param {string} preferredRevision
   * @return {!Promise<string>}
   */
  function waitForWSEndpoint(browserProcess, timeout, preferredRevision) {
    return new Promise((resolve, reject) => {
      const rl = readline.createInterface({ input: browserProcess.stderr });
      let stderr = '';
      const listeners = [
        helper.addEventListener(rl, 'line', onLine),
        helper.addEventListener(rl, 'close', () => onClose()),
        helper.addEventListener(browserProcess, 'exit', () => onClose()),
        helper.addEventListener(browserProcess, 'error', error => onClose(error))
      ];
      const timeoutId = timeout ? setTimeout(onTimeout, timeout) : 0;
  
      /**
       * @param {!Error=} error
       */
      function onClose(error) {
        cleanup();
        reject(new Error([
          'Failed to launch the browser process!' + (error ? ' ' + error.message : ''),
          stderr,
          '',
          'TROUBLESHOOTING: https://github.com/puppeteer/puppeteer/blob/master/docs/troubleshooting.md',
          '',
        ].join('\n')));
      }
  
      function onTimeout() {
        cleanup();
        reject(new TimeoutError(`Timed out after ${timeout} ms while trying to connect to the browser! Only Chrome at revision r${preferredRevision} is guaranteed to work.`));
      }
  
      /**
       * @param {string} line
       */
      function onLine(line) {
        stderr += line + '\n';
        const match = line.match(/^DevTools listening on (ws:\/\/.*)$/);
        if (!match)
          return;
        cleanup();
        resolve(match[1]);
      }
  
      function cleanup() {
        if (timeoutId)
          clearTimeout(timeoutId);
        helper.removeEventListeners(listeners);
      }
    });
  }
  
  /**
   * @param {string} browserURL
   * @return {!Promise<string>}
   */
  function getWSEndpoint(browserURL) {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  
    const endpointURL = URL.resolve(browserURL, '/json/version');
    const protocol = endpointURL.startsWith('https') ? https : http;
    const requestOptions = Object.assign(URL.parse(endpointURL), { method: 'GET' });
    const request = protocol.request(requestOptions, res => {
      let data = '';
      if (res.statusCode !== 200) {
        // Consume response data to free up memory.
        res.resume();
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data).webSocketDebuggerUrl));
    });
  
    request.on('error', reject);
    request.end();
  
    return promise.catch(e => {
      e.message = `Failed to fetch browser webSocket url from ${endpointURL}: ` + e.message;
      throw e;
    });
  }
  
  /**
   * @param {ChromeLauncher|FirefoxLauncher} launcher
   *
   * @return {{executablePath: string, missingText: ?string}}
   */
  function resolveExecutablePath(launcher) {
    // puppeteer-core doesn't take into account PUPPETEER_* env variables.
    if (!launcher._isPuppeteerCore) {
      const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.npm_config_puppeteer_executable_path || process.env.npm_package_config_puppeteer_executable_path;
      if (executablePath) {
        const missingText = !fs.existsSync(executablePath) ? 'Tried to use PUPPETEER_EXECUTABLE_PATH env variable to launch browser but did not find any executable at: ' + executablePath : null;
        return { executablePath, missingText };
      }
    }
    const browserFetcher = new BrowserFetcher(launcher._projectRoot);
    if (!launcher._isPuppeteerCore) {
      const revision = process.env['PUPPETEER_CHROMIUM_REVISION'];
      if (revision) {
        const revisionInfo = browserFetcher.revisionInfo(revision);
        const missingText = !revisionInfo.local ? 'Tried to use PUPPETEER_CHROMIUM_REVISION env variable to launch browser but did not find executable at: ' + revisionInfo.executablePath : null;
        return {executablePath: revisionInfo.executablePath, missingText};
      }
    }
    const revisionInfo = browserFetcher.revisionInfo(launcher._preferredRevision);
    const missingText = !revisionInfo.local ? `Browser is not downloaded. Run "npm install" or "yarn install"` : null;
    return {executablePath: revisionInfo.executablePath, missingText};
  }
  
  /**
   * @param {string} projectRoot
   * @param {string} preferredRevision
   * @param {boolean} isPuppeteerCore
   * @param {string=} product
   * @return {!Puppeteer.ProductLauncher}
   */
  function Launcher(projectRoot, preferredRevision, isPuppeteerCore, product) {
    // puppeteer-core doesn't take into account PUPPETEER_* env variables.
    if (!product && !isPuppeteerCore)
      product = process.env.PUPPETEER_PRODUCT || process.env.npm_config_puppeteer_product || process.env.npm_package_config_puppeteer_product;
    switch (product) {
      case 'firefox':
        return new FirefoxLauncher(projectRoot, preferredRevision, isPuppeteerCore);
      case 'chrome':
      default:
        return new ChromeLauncher(projectRoot, preferredRevision, isPuppeteerCore);
    }
  }
  
  
  /**
   * @typedef {Object} Launcher.ChromeArgOptions
   * @property {boolean=} headless
   * @property {Array<string>=} args
   * @property {string=} userDataDir
   * @property {boolean=} devtools
   */
  
  /**
   * @typedef {Object} Launcher.LaunchOptions
   * @property {string=} executablePath
   * @property {boolean|Array<string>=} ignoreDefaultArgs
   * @property {boolean=} handleSIGINT
   * @property {boolean=} handleSIGTERM
   * @property {boolean=} handleSIGHUP
   * @property {number=} timeout
   * @property {boolean=} dumpio
   * @property {!Object<string, string | undefined>=} env
   * @property {boolean=} pipe
   */
  
  /**
   * @typedef {Object} Launcher.BrowserOptions
   * @property {boolean=} ignoreHTTPSErrors
   * @property {(?Puppeteer.Viewport)=} defaultViewport
   * @property {number=} slowMo
   */
  
  
  module.exports = Launcher;
  
  }).call(this)}).call(this,require('_process'))
  },{"./Browser":42,"./BrowserFetcher":2,"./Connection":43,"./Errors":49,"./PipeTransport":59,"./WebSocketTransport":66,"./helper":69,"_process":11,"child_process":2,"debug":70,"fs":2,"http":17,"https":6,"os":9,"path":10,"readline":2,"rimraf":2,"url":37}],56:[function(require,module,exports){
  /**
   * Copyright 2019 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  
  const {helper, assert} = require('./helper');
  const {Events} = require('./Events');
  const {TimeoutError} = require('./Errors');
  
  class LifecycleWatcher {
    /**
     * @param {!Puppeteer.FrameManager} frameManager
     * @param {!Puppeteer.Frame} frame
     * @param {string|!Array<string>} waitUntil
     * @param {number} timeout
     */
    constructor(frameManager, frame, waitUntil, timeout) {
      if (Array.isArray(waitUntil))
        waitUntil = waitUntil.slice();
      else if (typeof waitUntil === 'string')
        waitUntil = [waitUntil];
      this._expectedLifecycle = waitUntil.map(value => {
        const protocolEvent = puppeteerToProtocolLifecycle.get(value);
        assert(protocolEvent, 'Unknown value for options.waitUntil: ' + value);
        return protocolEvent;
      });
  
      this._frameManager = frameManager;
      this._frame = frame;
      this._initialLoaderId = frame._loaderId;
      this._timeout = timeout;
      /** @type {?Puppeteer.Request} */
      this._navigationRequest = null;
      this._eventListeners = [
        helper.addEventListener(frameManager._client, Events.CDPSession.Disconnected, () => this._terminate(new Error('Navigation failed because browser has disconnected!'))),
        helper.addEventListener(this._frameManager, Events.FrameManager.LifecycleEvent, this._checkLifecycleComplete.bind(this)),
        helper.addEventListener(this._frameManager, Events.FrameManager.FrameNavigatedWithinDocument, this._navigatedWithinDocument.bind(this)),
        helper.addEventListener(this._frameManager, Events.FrameManager.FrameDetached, this._onFrameDetached.bind(this)),
        helper.addEventListener(this._frameManager.networkManager(), Events.NetworkManager.Request, this._onRequest.bind(this)),
      ];
  
      this._sameDocumentNavigationPromise = new Promise(fulfill => {
        this._sameDocumentNavigationCompleteCallback = fulfill;
      });
  
      this._lifecyclePromise = new Promise(fulfill => {
        this._lifecycleCallback = fulfill;
      });
  
      this._newDocumentNavigationPromise = new Promise(fulfill => {
        this._newDocumentNavigationCompleteCallback = fulfill;
      });
  
      this._timeoutPromise = this._createTimeoutPromise();
      this._terminationPromise = new Promise(fulfill => {
        this._terminationCallback = fulfill;
      });
      this._checkLifecycleComplete();
    }
  
    /**
     * @param {!Puppeteer.Request} request
     */
    _onRequest(request) {
      if (request.frame() !== this._frame || !request.isNavigationRequest())
        return;
      this._navigationRequest = request;
    }
  
    /**
     * @param {!Puppeteer.Frame} frame
     */
    _onFrameDetached(frame) {
      if (this._frame === frame) {
        this._terminationCallback.call(null, new Error('Navigating frame was detached'));
        return;
      }
      this._checkLifecycleComplete();
    }
  
    /**
     * @return {?Puppeteer.Response}
     */
    navigationResponse() {
      return this._navigationRequest ? this._navigationRequest.response() : null;
    }
  
    /**
     * @param {!Error} error
     */
    _terminate(error) {
      this._terminationCallback.call(null, error);
    }
  
    /**
     * @return {!Promise<?Error>}
     */
    sameDocumentNavigationPromise() {
      return this._sameDocumentNavigationPromise;
    }
  
    /**
     * @return {!Promise<?Error>}
     */
    newDocumentNavigationPromise() {
      return this._newDocumentNavigationPromise;
    }
  
    /**
     * @return {!Promise}
     */
    lifecyclePromise() {
      return this._lifecyclePromise;
    }
  
    /**
     * @return {!Promise<?Error>}
     */
    timeoutOrTerminationPromise() {
      return Promise.race([this._timeoutPromise, this._terminationPromise]);
    }
  
    /**
     * @return {!Promise<?Error>}
     */
    _createTimeoutPromise() {
      if (!this._timeout)
        return new Promise(() => {});
      const errorMessage = 'Navigation timeout of ' + this._timeout + ' ms exceeded';
      return new Promise(fulfill => this._maximumTimer = setTimeout(fulfill, this._timeout))
          .then(() => new TimeoutError(errorMessage));
    }
  
    /**
     * @param {!Puppeteer.Frame} frame
     */
    _navigatedWithinDocument(frame) {
      if (frame !== this._frame)
        return;
      this._hasSameDocumentNavigation = true;
      this._checkLifecycleComplete();
    }
  
    _checkLifecycleComplete() {
      // We expect navigation to commit.
      if (!checkLifecycle(this._frame, this._expectedLifecycle))
        return;
      this._lifecycleCallback();
      if (this._frame._loaderId === this._initialLoaderId && !this._hasSameDocumentNavigation)
        return;
      if (this._hasSameDocumentNavigation)
        this._sameDocumentNavigationCompleteCallback();
      if (this._frame._loaderId !== this._initialLoaderId)
        this._newDocumentNavigationCompleteCallback();
  
      /**
       * @param {!Puppeteer.Frame} frame
       * @param {!Array<string>} expectedLifecycle
       * @return {boolean}
       */
      function checkLifecycle(frame, expectedLifecycle) {
        for (const event of expectedLifecycle) {
          if (!frame._lifecycleEvents.has(event))
            return false;
        }
        for (const child of frame.childFrames()) {
          if (!checkLifecycle(child, expectedLifecycle))
            return false;
        }
        return true;
      }
    }
  
    dispose() {
      helper.removeEventListeners(this._eventListeners);
      clearTimeout(this._maximumTimer);
    }
  }
  
  const puppeteerToProtocolLifecycle = new Map([
    ['load', 'load'],
    ['domcontentloaded', 'DOMContentLoaded'],
    ['networkidle0', 'networkIdle'],
    ['networkidle2', 'networkAlmostIdle'],
  ]);
  
  module.exports = {LifecycleWatcher};
  
  },{"./Errors":49,"./Events":50,"./helper":69}],57:[function(require,module,exports){
  (function (Buffer){(function (){
  /**
   * Copyright 2017 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  const EventEmitter = require('events');
  const {helper, assert, debugError} = require('./helper');
  const {Events} = require('./Events');
  
  class NetworkManager extends EventEmitter {
    /**
     * @param {!Puppeteer.CDPSession} client
     * @param {!Puppeteer.FrameManager} frameManager
     */
    constructor(client, ignoreHTTPSErrors, frameManager) {
      super();
      this._client = client;
      this._ignoreHTTPSErrors = ignoreHTTPSErrors;
      this._frameManager = frameManager;
      /** @type {!Map<string, !Request>} */
      this._requestIdToRequest = new Map();
      /** @type {!Map<string, !Protocol.Network.requestWillBeSentPayload>} */
      this._requestIdToRequestWillBeSentEvent = new Map();
      /** @type {!Object<string, string>} */
      this._extraHTTPHeaders = {};
  
      this._offline = false;
  
      /** @type {?{username: string, password: string}} */
      this._credentials = null;
      /** @type {!Set<string>} */
      this._attemptedAuthentications = new Set();
      this._userRequestInterceptionEnabled = false;
      this._protocolRequestInterceptionEnabled = false;
      this._userCacheDisabled = false;
      /** @type {!Map<string, string>} */
      this._requestIdToInterceptionId = new Map();
  
      this._client.on('Fetch.requestPaused', this._onRequestPaused.bind(this));
      this._client.on('Fetch.authRequired', this._onAuthRequired.bind(this));
      this._client.on('Network.requestWillBeSent', this._onRequestWillBeSent.bind(this));
      this._client.on('Network.requestServedFromCache', this._onRequestServedFromCache.bind(this));
      this._client.on('Network.responseReceived', this._onResponseReceived.bind(this));
      this._client.on('Network.loadingFinished', this._onLoadingFinished.bind(this));
      this._client.on('Network.loadingFailed', this._onLoadingFailed.bind(this));
    }
  
    async initialize() {
      await this._client.send('Network.enable');
      if (this._ignoreHTTPSErrors)
        await this._client.send('Security.setIgnoreCertificateErrors', {ignore: true});
    }
  
    /**
     * @param {?{username: string, password: string}} credentials
     */
    async authenticate(credentials) {
      this._credentials = credentials;
      await this._updateProtocolRequestInterception();
    }
  
    /**
     * @param {!Object<string, string>} extraHTTPHeaders
     */
    async setExtraHTTPHeaders(extraHTTPHeaders) {
      this._extraHTTPHeaders = {};
      for (const key of Object.keys(extraHTTPHeaders)) {
        const value = extraHTTPHeaders[key];
        assert(helper.isString(value), `Expected value of header "${key}" to be String, but "${typeof value}" is found.`);
        this._extraHTTPHeaders[key.toLowerCase()] = value;
      }
      await this._client.send('Network.setExtraHTTPHeaders', { headers: this._extraHTTPHeaders });
    }
  
    /**
     * @return {!Object<string, string>}
     */
    extraHTTPHeaders() {
      return Object.assign({}, this._extraHTTPHeaders);
    }
  
    /**
     * @param {boolean} value
     */
    async setOfflineMode(value) {
      if (this._offline === value)
        return;
      this._offline = value;
      await this._client.send('Network.emulateNetworkConditions', {
        offline: this._offline,
        // values of 0 remove any active throttling. crbug.com/456324#c9
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1
      });
    }
  
    /**
     * @param {string} userAgent
     */
    async setUserAgent(userAgent) {
      await this._client.send('Network.setUserAgentOverride', { userAgent });
    }
  
    /**
     * @param {boolean} enabled
     */
    async setCacheEnabled(enabled) {
      this._userCacheDisabled = !enabled;
      await this._updateProtocolCacheDisabled();
    }
  
    /**
     * @param {boolean} value
     */
    async setRequestInterception(value) {
      this._userRequestInterceptionEnabled = value;
      await this._updateProtocolRequestInterception();
    }
  
    async _updateProtocolRequestInterception() {
      const enabled = this._userRequestInterceptionEnabled || !!this._credentials;
      if (enabled === this._protocolRequestInterceptionEnabled)
        return;
      this._protocolRequestInterceptionEnabled = enabled;
      if (enabled) {
        await Promise.all([
          this._updateProtocolCacheDisabled(),
          this._client.send('Fetch.enable', {
            handleAuthRequests: true,
            patterns: [{urlPattern: '*'}],
          }),
        ]);
      } else {
        await Promise.all([
          this._updateProtocolCacheDisabled(),
          this._client.send('Fetch.disable')
        ]);
      }
    }
  
    async _updateProtocolCacheDisabled() {
      await this._client.send('Network.setCacheDisabled', {
        cacheDisabled: this._userCacheDisabled || this._protocolRequestInterceptionEnabled
      });
    }
  
    /**
     * @param {!Protocol.Network.requestWillBeSentPayload} event
     */
    _onRequestWillBeSent(event) {
      // Request interception doesn't happen for data URLs with Network Service.
      if (this._protocolRequestInterceptionEnabled && !event.request.url.startsWith('data:')) {
        const requestId = event.requestId;
        const interceptionId = this._requestIdToInterceptionId.get(requestId);
        if (interceptionId) {
          this._onRequest(event, interceptionId);
          this._requestIdToInterceptionId.delete(requestId);
        } else {
          this._requestIdToRequestWillBeSentEvent.set(event.requestId, event);
        }
        return;
      }
      this._onRequest(event, null);
    }
  
    /**
     * @param {!Protocol.Fetch.authRequiredPayload} event
     */
    _onAuthRequired(event) {
      /** @type {"Default"|"CancelAuth"|"ProvideCredentials"} */
      let response = 'Default';
      if (this._attemptedAuthentications.has(event.requestId)) {
        response = 'CancelAuth';
      } else if (this._credentials) {
        response = 'ProvideCredentials';
        this._attemptedAuthentications.add(event.requestId);
      }
      const {username, password} = this._credentials || {username: undefined, password: undefined};
      this._client.send('Fetch.continueWithAuth', {
        requestId: event.requestId,
        authChallengeResponse: { response, username, password },
      }).catch(debugError);
    }
  
    /**
     * @param {!Protocol.Fetch.requestPausedPayload} event
     */
    _onRequestPaused(event) {
      if (!this._userRequestInterceptionEnabled && this._protocolRequestInterceptionEnabled) {
        this._client.send('Fetch.continueRequest', {
          requestId: event.requestId
        }).catch(debugError);
      }
  
      const requestId = event.networkId;
      const interceptionId = event.requestId;
      if (requestId && this._requestIdToRequestWillBeSentEvent.has(requestId)) {
        const requestWillBeSentEvent = this._requestIdToRequestWillBeSentEvent.get(requestId);
        this._onRequest(requestWillBeSentEvent, interceptionId);
        this._requestIdToRequestWillBeSentEvent.delete(requestId);
      } else {
        this._requestIdToInterceptionId.set(requestId, interceptionId);
      }
    }
  
    /**
     * @param {!Protocol.Network.requestWillBeSentPayload} event
     * @param {?string} interceptionId
     */
    _onRequest(event, interceptionId) {
      let redirectChain = [];
      if (event.redirectResponse) {
        const request = this._requestIdToRequest.get(event.requestId);
        // If we connect late to the target, we could have missed the requestWillBeSent event.
        if (request) {
          this._handleRequestRedirect(request, event.redirectResponse);
          redirectChain = request._redirectChain;
        }
      }
      const frame = event.frameId ? this._frameManager.frame(event.frameId) : null;
      const request = new Request(this._client, frame, interceptionId, this._userRequestInterceptionEnabled, event, redirectChain);
      this._requestIdToRequest.set(event.requestId, request);
      this.emit(Events.NetworkManager.Request, request);
    }
  
  
    /**
     * @param {!Protocol.Network.requestServedFromCachePayload} event
     */
    _onRequestServedFromCache(event) {
      const request = this._requestIdToRequest.get(event.requestId);
      if (request)
        request._fromMemoryCache = true;
    }
  
    /**
     * @param {!Request} request
     * @param {!Protocol.Network.Response} responsePayload
     */
    _handleRequestRedirect(request, responsePayload) {
      const response = new Response(this._client, request, responsePayload);
      request._response = response;
      request._redirectChain.push(request);
      response._bodyLoadedPromiseFulfill.call(null, new Error('Response body is unavailable for redirect responses'));
      this._requestIdToRequest.delete(request._requestId);
      this._attemptedAuthentications.delete(request._interceptionId);
      this.emit(Events.NetworkManager.Response, response);
      this.emit(Events.NetworkManager.RequestFinished, request);
    }
  
    /**
     * @param {!Protocol.Network.responseReceivedPayload} event
     */
    _onResponseReceived(event) {
      const request = this._requestIdToRequest.get(event.requestId);
      // FileUpload sends a response without a matching request.
      if (!request)
        return;
      const response = new Response(this._client, request, event.response);
      request._response = response;
      this.emit(Events.NetworkManager.Response, response);
    }
  
    /**
     * @param {!Protocol.Network.loadingFinishedPayload} event
     */
    _onLoadingFinished(event) {
      const request = this._requestIdToRequest.get(event.requestId);
      // For certain requestIds we never receive requestWillBeSent event.
      // @see https://crbug.com/750469
      if (!request)
        return;
  
      // Under certain conditions we never get the Network.responseReceived
      // event from protocol. @see https://crbug.com/883475
      if (request.response())
        request.response()._bodyLoadedPromiseFulfill.call(null);
      this._requestIdToRequest.delete(request._requestId);
      this._attemptedAuthentications.delete(request._interceptionId);
      this.emit(Events.NetworkManager.RequestFinished, request);
    }
  
    /**
     * @param {!Protocol.Network.loadingFailedPayload} event
     */
    _onLoadingFailed(event) {
      const request = this._requestIdToRequest.get(event.requestId);
      // For certain requestIds we never receive requestWillBeSent event.
      // @see https://crbug.com/750469
      if (!request)
        return;
      request._failureText = event.errorText;
      const response = request.response();
      if (response)
        response._bodyLoadedPromiseFulfill.call(null);
      this._requestIdToRequest.delete(request._requestId);
      this._attemptedAuthentications.delete(request._interceptionId);
      this.emit(Events.NetworkManager.RequestFailed, request);
    }
  }
  
  class Request {
    /**
     * @param {!Puppeteer.CDPSession} client
     * @param {?Puppeteer.Frame} frame
     * @param {string} interceptionId
     * @param {boolean} allowInterception
     * @param {!Protocol.Network.requestWillBeSentPayload} event
     * @param {!Array<!Request>} redirectChain
     */
    constructor(client, frame, interceptionId, allowInterception, event, redirectChain) {
      this._client = client;
      this._requestId = event.requestId;
      this._isNavigationRequest = event.requestId === event.loaderId && event.type === 'Document';
      this._interceptionId = interceptionId;
      this._allowInterception = allowInterception;
      this._interceptionHandled = false;
      this._response = null;
      this._failureText = null;
  
      this._url = event.request.url;
      this._resourceType = event.type.toLowerCase();
      this._method = event.request.method;
      this._postData = event.request.postData;
      this._headers = {};
      this._frame = frame;
      this._redirectChain = redirectChain;
      for (const key of Object.keys(event.request.headers))
        this._headers[key.toLowerCase()] = event.request.headers[key];
  
      this._fromMemoryCache = false;
    }
  
    /**
     * @return {string}
     */
    url() {
      return this._url;
    }
  
    /**
     * @return {string}
     */
    resourceType() {
      return this._resourceType;
    }
  
    /**
     * @return {string}
     */
    method() {
      return this._method;
    }
  
    /**
     * @return {string|undefined}
     */
    postData() {
      return this._postData;
    }
  
    /**
     * @return {!Object}
     */
    headers() {
      return this._headers;
    }
  
    /**
     * @return {?Response}
     */
    response() {
      return this._response;
    }
  
    /**
     * @return {?Puppeteer.Frame}
     */
    frame() {
      return this._frame;
    }
  
    /**
     * @return {boolean}
     */
    isNavigationRequest() {
      return this._isNavigationRequest;
    }
  
    /**
     * @return {!Array<!Request>}
     */
    redirectChain() {
      return this._redirectChain.slice();
    }
  
    /**
     * @return {?{errorText: string}}
     */
    failure() {
      if (!this._failureText)
        return null;
      return {
        errorText: this._failureText
      };
    }
  
    /**
     * @param {!{url?: string, method?:string, postData?: string, headers?: !Object}} overrides
     */
    async continue(overrides = {}) {
      // Request interception is not supported for data: urls.
      if (this._url.startsWith('data:'))
        return;
      assert(this._allowInterception, 'Request Interception is not enabled!');
      assert(!this._interceptionHandled, 'Request is already handled!');
      const {
        url,
        method,
        postData,
        headers
      } = overrides;
      this._interceptionHandled = true;
      await this._client.send('Fetch.continueRequest', {
        requestId: this._interceptionId,
        url,
        method,
        postData,
        headers: headers ? headersArray(headers) : undefined,
      }).catch(error => {
        // In certain cases, protocol will return error if the request was already canceled
        // or the page was closed. We should tolerate these errors.
        debugError(error);
      });
    }
  
    /**
     * @param {!{status: number, headers: Object, contentType: string, body: (string|Buffer)}} response
     */
    async respond(response) {
      // Mocking responses for dataURL requests is not currently supported.
      if (this._url.startsWith('data:'))
        return;
      assert(this._allowInterception, 'Request Interception is not enabled!');
      assert(!this._interceptionHandled, 'Request is already handled!');
      this._interceptionHandled = true;
  
      const responseBody = response.body && helper.isString(response.body) ? Buffer.from(/** @type {string} */(response.body)) : /** @type {?Buffer} */(response.body || null);
  
      /** @type {!Object<string, string>} */
      const responseHeaders = {};
      if (response.headers) {
        for (const header of Object.keys(response.headers))
          responseHeaders[header.toLowerCase()] = response.headers[header];
      }
      if (response.contentType)
        responseHeaders['content-type'] = response.contentType;
      if (responseBody && !('content-length' in responseHeaders))
        responseHeaders['content-length'] = String(Buffer.byteLength(responseBody));
  
      await this._client.send('Fetch.fulfillRequest', {
        requestId: this._interceptionId,
        responseCode: response.status || 200,
        responsePhrase: STATUS_TEXTS[response.status || 200],
        responseHeaders: headersArray(responseHeaders),
        body: responseBody ? responseBody.toString('base64') : undefined,
      }).catch(error => {
        // In certain cases, protocol will return error if the request was already canceled
        // or the page was closed. We should tolerate these errors.
        debugError(error);
      });
    }
  
    /**
     * @param {string=} errorCode
     */
    async abort(errorCode = 'failed') {
      // Request interception is not supported for data: urls.
      if (this._url.startsWith('data:'))
        return;
      const errorReason = errorReasons[errorCode];
      assert(errorReason, 'Unknown error code: ' + errorCode);
      assert(this._allowInterception, 'Request Interception is not enabled!');
      assert(!this._interceptionHandled, 'Request is already handled!');
      this._interceptionHandled = true;
      await this._client.send('Fetch.failRequest', {
        requestId: this._interceptionId,
        errorReason
      }).catch(error => {
        // In certain cases, protocol will return error if the request was already canceled
        // or the page was closed. We should tolerate these errors.
        debugError(error);
      });
    }
  }
  
  const errorReasons = {
    'aborted': 'Aborted',
    'accessdenied': 'AccessDenied',
    'addressunreachable': 'AddressUnreachable',
    'blockedbyclient': 'BlockedByClient',
    'blockedbyresponse': 'BlockedByResponse',
    'connectionaborted': 'ConnectionAborted',
    'connectionclosed': 'ConnectionClosed',
    'connectionfailed': 'ConnectionFailed',
    'connectionrefused': 'ConnectionRefused',
    'connectionreset': 'ConnectionReset',
    'internetdisconnected': 'InternetDisconnected',
    'namenotresolved': 'NameNotResolved',
    'timedout': 'TimedOut',
    'failed': 'Failed',
  };
  
  class Response {
    /**
     * @param {!Puppeteer.CDPSession} client
     * @param {!Request} request
     * @param {!Protocol.Network.Response} responsePayload
     */
    constructor(client, request, responsePayload) {
      this._client = client;
      this._request = request;
      this._contentPromise = null;
  
      this._bodyLoadedPromise = new Promise(fulfill => {
        this._bodyLoadedPromiseFulfill = fulfill;
      });
  
      this._remoteAddress = {
        ip: responsePayload.remoteIPAddress,
        port: responsePayload.remotePort,
      };
      this._status = responsePayload.status;
      this._statusText = responsePayload.statusText;
      this._url = request.url();
      this._fromDiskCache = !!responsePayload.fromDiskCache;
      this._fromServiceWorker = !!responsePayload.fromServiceWorker;
      this._headers = {};
      for (const key of Object.keys(responsePayload.headers))
        this._headers[key.toLowerCase()] = responsePayload.headers[key];
      this._securityDetails = responsePayload.securityDetails ? new SecurityDetails(responsePayload.securityDetails) : null;
    }
  
    /**
     * @return {{ip: string, port: number}}
     */
    remoteAddress() {
      return this._remoteAddress;
    }
  
    /**
     * @return {string}
     */
    url() {
      return this._url;
    }
  
    /**
     * @return {boolean}
     */
    ok() {
      return this._status === 0 || (this._status >= 200 && this._status <= 299);
    }
  
    /**
     * @return {number}
     */
    status() {
      return this._status;
    }
  
    /**
     * @return {string}
     */
    statusText() {
      return this._statusText;
    }
  
    /**
     * @return {!Object}
     */
    headers() {
      return this._headers;
    }
  
    /**
     * @return {?SecurityDetails}
     */
    securityDetails() {
      return this._securityDetails;
    }
  
    /**
     * @return {!Promise<!Buffer>}
     */
    buffer() {
      if (!this._contentPromise) {
        this._contentPromise = this._bodyLoadedPromise.then(async error => {
          if (error)
            throw error;
          const response = await this._client.send('Network.getResponseBody', {
            requestId: this._request._requestId
          });
          return Buffer.from(response.body, response.base64Encoded ? 'base64' : 'utf8');
        });
      }
      return this._contentPromise;
    }
  
    /**
     * @return {!Promise<string>}
     */
    async text() {
      const content = await this.buffer();
      return content.toString('utf8');
    }
  
    /**
     * @return {!Promise<!Object>}
     */
    async json() {
      const content = await this.text();
      return JSON.parse(content);
    }
  
    /**
     * @return {!Request}
     */
    request() {
      return this._request;
    }
  
    /**
     * @return {boolean}
     */
    fromCache() {
      return this._fromDiskCache || this._request._fromMemoryCache;
    }
  
    /**
     * @return {boolean}
     */
    fromServiceWorker() {
      return this._fromServiceWorker;
    }
  
    /**
     * @return {?Puppeteer.Frame}
     */
    frame() {
      return this._request.frame();
    }
  }
  
  class SecurityDetails {
    /**
     * @param {!Protocol.Network.SecurityDetails} securityPayload
     */
    constructor(securityPayload) {
      this._subjectName = securityPayload['subjectName'];
      this._issuer = securityPayload['issuer'];
      this._validFrom = securityPayload['validFrom'];
      this._validTo = securityPayload['validTo'];
      this._protocol = securityPayload['protocol'];
    }
  
    /**
     * @return {string}
     */
    subjectName() {
      return this._subjectName;
    }
  
    /**
     * @return {string}
     */
    issuer() {
      return this._issuer;
    }
  
    /**
     * @return {number}
     */
    validFrom() {
      return this._validFrom;
    }
  
    /**
     * @return {number}
     */
    validTo() {
      return this._validTo;
    }
  
    /**
     * @return {string}
     */
    protocol() {
      return this._protocol;
    }
  }
  
  /**
   * @param {Object<string, string>} headers
   * @return {!Array<{name: string, value: string}>}
   */
  function headersArray(headers) {
    const result = [];
    for (const name in headers) {
      if (!Object.is(headers[name], undefined))
        result.push({name, value: headers[name] + ''});
    }
    return result;
  }
  
  // List taken from https://www.iana.org/assignments/http-status-codes/http-status-codes.xhtml with extra 306 and 418 codes.
  const STATUS_TEXTS = {
    '100': 'Continue',
    '101': 'Switching Protocols',
    '102': 'Processing',
    '103': 'Early Hints',
    '200': 'OK',
    '201': 'Created',
    '202': 'Accepted',
    '203': 'Non-Authoritative Information',
    '204': 'No Content',
    '205': 'Reset Content',
    '206': 'Partial Content',
    '207': 'Multi-Status',
    '208': 'Already Reported',
    '226': 'IM Used',
    '300': 'Multiple Choices',
    '301': 'Moved Permanently',
    '302': 'Found',
    '303': 'See Other',
    '304': 'Not Modified',
    '305': 'Use Proxy',
    '306': 'Switch Proxy',
    '307': 'Temporary Redirect',
    '308': 'Permanent Redirect',
    '400': 'Bad Request',
    '401': 'Unauthorized',
    '402': 'Payment Required',
    '403': 'Forbidden',
    '404': 'Not Found',
    '405': 'Method Not Allowed',
    '406': 'Not Acceptable',
    '407': 'Proxy Authentication Required',
    '408': 'Request Timeout',
    '409': 'Conflict',
    '410': 'Gone',
    '411': 'Length Required',
    '412': 'Precondition Failed',
    '413': 'Payload Too Large',
    '414': 'URI Too Long',
    '415': 'Unsupported Media Type',
    '416': 'Range Not Satisfiable',
    '417': 'Expectation Failed',
    '418': 'I\'m a teapot',
    '421': 'Misdirected Request',
    '422': 'Unprocessable Entity',
    '423': 'Locked',
    '424': 'Failed Dependency',
    '425': 'Too Early',
    '426': 'Upgrade Required',
    '428': 'Precondition Required',
    '429': 'Too Many Requests',
    '431': 'Request Header Fields Too Large',
    '451': 'Unavailable For Legal Reasons',
    '500': 'Internal Server Error',
    '501': 'Not Implemented',
    '502': 'Bad Gateway',
    '503': 'Service Unavailable',
    '504': 'Gateway Timeout',
    '505': 'HTTP Version Not Supported',
    '506': 'Variant Also Negotiates',
    '507': 'Insufficient Storage',
    '508': 'Loop Detected',
    '510': 'Not Extended',
    '511': 'Network Authentication Required',
  };
  
  module.exports = {Request, Response, NetworkManager, SecurityDetails};
  
  }).call(this)}).call(this,require("buffer").Buffer)
  },{"./Events":50,"./helper":69,"buffer":3,"events":5}],58:[function(require,module,exports){
  (function (Buffer){(function (){
  /**
   * Copyright 2017 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  
  const fs = require('fs');
  const EventEmitter = require('events');
  const mime = require('mime');
  const {Events} = require('./Events');
  const {Connection} = require('./Connection');
  const {Dialog} = require('./Dialog');
  const {EmulationManager} = require('./EmulationManager');
  const {FrameManager} = require('./FrameManager');
  const {Keyboard, Mouse, Touchscreen} = require('./Input');
  const Tracing = require('./Tracing');
  const {helper, debugError, assert} = require('./helper');
  const {Coverage} = require('./Coverage');
  const {Worker} = require('./Worker');
  const {createJSHandle} = require('./JSHandle');
  const {Accessibility} = require('./Accessibility');
  const {TimeoutSettings} = require('./TimeoutSettings');
  
  const writeFileAsync = helper.promisify(fs.writeFile);
  
  class Page extends EventEmitter {
    /**
     * @param {!Puppeteer.CDPSession} client
     * @param {!Puppeteer.Target} target
     * @param {boolean} ignoreHTTPSErrors
     * @param {?Puppeteer.Viewport} defaultViewport
     * @param {!Puppeteer.TaskQueue} screenshotTaskQueue
     * @return {!Promise<!Page>}
     */
    static async create(client, target, ignoreHTTPSErrors, defaultViewport, screenshotTaskQueue) {
      const page = new Page(client, target, ignoreHTTPSErrors, screenshotTaskQueue);
      await page._initialize();
      if (defaultViewport)
        await page.setViewport(defaultViewport);
      return page;
    }
  
    /**
     * @param {!Puppeteer.CDPSession} client
     * @param {!Puppeteer.Target} target
     * @param {boolean} ignoreHTTPSErrors
     * @param {!Puppeteer.TaskQueue} screenshotTaskQueue
     */
    constructor(client, target, ignoreHTTPSErrors, screenshotTaskQueue) {
      super();
      this._closed = false;
      this._client = client;
      this._target = target;
      this._keyboard = new Keyboard(client);
      this._mouse = new Mouse(client, this._keyboard);
      this._timeoutSettings = new TimeoutSettings();
      this._touchscreen = new Touchscreen(client, this._keyboard);
      this._accessibility = new Accessibility(client);
      /** @type {!FrameManager} */
      this._frameManager = new FrameManager(client, this, ignoreHTTPSErrors, this._timeoutSettings);
      this._emulationManager = new EmulationManager(client);
      this._tracing = new Tracing(client);
      /** @type {!Map<string, Function>} */
      this._pageBindings = new Map();
      this._coverage = new Coverage(client);
      this._javascriptEnabled = true;
      /** @type {?Puppeteer.Viewport} */
      this._viewport = null;
  
      this._screenshotTaskQueue = screenshotTaskQueue;
  
      /** @type {!Map<string, Worker>} */
      this._workers = new Map();
      client.on('Target.attachedToTarget', event => {
        if (event.targetInfo.type !== 'worker') {
          // If we don't detach from service workers, they will never die.
          client.send('Target.detachFromTarget', {
            sessionId: event.sessionId
          }).catch(debugError);
          return;
        }
        const session = Connection.fromSession(client).session(event.sessionId);
        const worker = new Worker(session, event.targetInfo.url, this._addConsoleMessage.bind(this), this._handleException.bind(this));
        this._workers.set(event.sessionId, worker);
        this.emit(Events.Page.WorkerCreated, worker);
      });
      client.on('Target.detachedFromTarget', event => {
        const worker = this._workers.get(event.sessionId);
        if (!worker)
          return;
        this.emit(Events.Page.WorkerDestroyed, worker);
        this._workers.delete(event.sessionId);
      });
  
      this._frameManager.on(Events.FrameManager.FrameAttached, event => this.emit(Events.Page.FrameAttached, event));
      this._frameManager.on(Events.FrameManager.FrameDetached, event => this.emit(Events.Page.FrameDetached, event));
      this._frameManager.on(Events.FrameManager.FrameNavigated, event => this.emit(Events.Page.FrameNavigated, event));
  
      const networkManager = this._frameManager.networkManager();
      networkManager.on(Events.NetworkManager.Request, event => this.emit(Events.Page.Request, event));
      networkManager.on(Events.NetworkManager.Response, event => this.emit(Events.Page.Response, event));
      networkManager.on(Events.NetworkManager.RequestFailed, event => this.emit(Events.Page.RequestFailed, event));
      networkManager.on(Events.NetworkManager.RequestFinished, event => this.emit(Events.Page.RequestFinished, event));
      this._fileChooserInterceptors = new Set();
  
      client.on('Page.domContentEventFired', event => this.emit(Events.Page.DOMContentLoaded));
      client.on('Page.loadEventFired', event => this.emit(Events.Page.Load));
      client.on('Runtime.consoleAPICalled', event => this._onConsoleAPI(event));
      client.on('Runtime.bindingCalled', event => this._onBindingCalled(event));
      client.on('Page.javascriptDialogOpening', event => this._onDialog(event));
      client.on('Runtime.exceptionThrown', exception => this._handleException(exception.exceptionDetails));
      client.on('Inspector.targetCrashed', event => this._onTargetCrashed());
      client.on('Performance.metrics', event => this._emitMetrics(event));
      client.on('Log.entryAdded', event => this._onLogEntryAdded(event));
      client.on('Page.fileChooserOpened', event => this._onFileChooser(event));
      this._target._isClosedPromise.then(() => {
        this.emit(Events.Page.Close);
        this._closed = true;
      });
    }
  
    async _initialize() {
      await Promise.all([
        this._frameManager.initialize(),
        this._client.send('Target.setAutoAttach', {autoAttach: true, waitForDebuggerOnStart: false, flatten: true}),
        this._client.send('Performance.enable', {}),
        this._client.send('Log.enable', {}),
      ]);
    }
  
    /**
     * @param {!Protocol.Page.fileChooserOpenedPayload} event
     */
    async _onFileChooser(event) {
      if (!this._fileChooserInterceptors.size)
        return;
      const frame = this._frameManager.frame(event.frameId);
      const context = await frame.executionContext();
      const element = await context._adoptBackendNodeId(event.backendNodeId);
      const interceptors = Array.from(this._fileChooserInterceptors);
      this._fileChooserInterceptors.clear();
      const fileChooser = new FileChooser(this._client, element, event);
      for (const interceptor of interceptors)
        interceptor.call(null, fileChooser);
    }
  
    /**
     * @param {!{timeout?: number}=} options
     * @return !Promise<!FileChooser>}
     */
    async waitForFileChooser(options = {}) {
      if (!this._fileChooserInterceptors.size)
        await this._client.send('Page.setInterceptFileChooserDialog', {enabled: true});
  
      const {
        timeout = this._timeoutSettings.timeout(),
      } = options;
      let callback;
      const promise = new Promise(x => callback = x);
      this._fileChooserInterceptors.add(callback);
      return helper.waitWithTimeout(promise, 'waiting for file chooser', timeout).catch(e => {
        this._fileChooserInterceptors.delete(callback);
        throw e;
      });
    }
  
    /**
     * @param {!{longitude: number, latitude: number, accuracy: (number|undefined)}} options
     */
    async setGeolocation(options) {
      const { longitude, latitude, accuracy = 0} = options;
      if (longitude < -180 || longitude > 180)
        throw new Error(`Invalid longitude "${longitude}": precondition -180 <= LONGITUDE <= 180 failed.`);
      if (latitude < -90 || latitude > 90)
        throw new Error(`Invalid latitude "${latitude}": precondition -90 <= LATITUDE <= 90 failed.`);
      if (accuracy < 0)
        throw new Error(`Invalid accuracy "${accuracy}": precondition 0 <= ACCURACY failed.`);
      await this._client.send('Emulation.setGeolocationOverride', {longitude, latitude, accuracy});
    }
  
    /**
     * @return {!Puppeteer.Target}
     */
    target() {
      return this._target;
    }
  
    /**
     * @return {!Puppeteer.Browser}
     */
    browser() {
      return this._target.browser();
    }
  
    /**
     * @return {!Puppeteer.BrowserContext}
     */
    browserContext() {
      return this._target.browserContext();
    }
  
    _onTargetCrashed() {
      this.emit('error', new Error('Page crashed!'));
    }
  
    /**
     * @param {!Protocol.Log.entryAddedPayload} event
     */
    _onLogEntryAdded(event) {
      const {level, text, args, source, url, lineNumber} = event.entry;
      if (args)
        args.map(arg => helper.releaseObject(this._client, arg));
      if (source !== 'worker')
        this.emit(Events.Page.Console, new ConsoleMessage(level, text, [], {url, lineNumber}));
    }
  
    /**
     * @return {!Puppeteer.Frame}
     */
    mainFrame() {
      return this._frameManager.mainFrame();
    }
  
    /**
     * @return {!Keyboard}
     */
    get keyboard() {
      return this._keyboard;
    }
  
    /**
     * @return {!Touchscreen}
     */
    get touchscreen() {
      return this._touchscreen;
    }
  
    /**
     * @return {!Coverage}
     */
    get coverage() {
      return this._coverage;
    }
  
    /**
     * @return {!Tracing}
     */
    get tracing() {
      return this._tracing;
    }
  
    /**
     * @return {!Accessibility}
     */
    get accessibility() {
      return this._accessibility;
    }
  
    /**
     * @return {!Array<Puppeteer.Frame>}
     */
    frames() {
      return this._frameManager.frames();
    }
  
    /**
     * @return {!Array<!Worker>}
     */
    workers() {
      return Array.from(this._workers.values());
    }
  
    /**
     * @param {boolean} value
     */
    async setRequestInterception(value) {
      return this._frameManager.networkManager().setRequestInterception(value);
    }
  
    /**
     * @param {boolean} enabled
     */
    setOfflineMode(enabled) {
      return this._frameManager.networkManager().setOfflineMode(enabled);
    }
  
    /**
     * @param {number} timeout
     */
    setDefaultNavigationTimeout(timeout) {
      this._timeoutSettings.setDefaultNavigationTimeout(timeout);
    }
  
    /**
     * @param {number} timeout
     */
    setDefaultTimeout(timeout) {
      this._timeoutSettings.setDefaultTimeout(timeout);
    }
  
    /**
     * @param {string} selector
     * @return {!Promise<?Puppeteer.ElementHandle>}
     */
    async $(selector) {
      return this.mainFrame().$(selector);
    }
  
    /**
     * @param {Function|string} pageFunction
     * @param {!Array<*>} args
     * @return {!Promise<!Puppeteer.JSHandle>}
     */
    async evaluateHandle(pageFunction, ...args) {
      const context = await this.mainFrame().executionContext();
      return context.evaluateHandle(pageFunction, ...args);
    }
  
    /**
     * @param {!Puppeteer.JSHandle} prototypeHandle
     * @return {!Promise<!Puppeteer.JSHandle>}
     */
    async queryObjects(prototypeHandle) {
      const context = await this.mainFrame().executionContext();
      return context.queryObjects(prototypeHandle);
    }
  
    /**
     * @param {string} selector
     * @param {Function|string} pageFunction
     * @param {!Array<*>} args
     * @return {!Promise<(!Object|undefined)>}
     */
    async $eval(selector, pageFunction, ...args) {
      return this.mainFrame().$eval(selector, pageFunction, ...args);
    }
  
    /**
     * @param {string} selector
     * @param {Function|string} pageFunction
     * @param {!Array<*>} args
     * @return {!Promise<(!Object|undefined)>}
     */
    async $$eval(selector, pageFunction, ...args) {
      return this.mainFrame().$$eval(selector, pageFunction, ...args);
    }
  
    /**
     * @param {string} selector
     * @return {!Promise<!Array<!Puppeteer.ElementHandle>>}
     */
    async $$(selector) {
      return this.mainFrame().$$(selector);
    }
  
    /**
     * @param {string} expression
     * @return {!Promise<!Array<!Puppeteer.ElementHandle>>}
     */
    async $x(expression) {
      return this.mainFrame().$x(expression);
    }
  
    /**
     * @param {!Array<string>} urls
     * @return {!Promise<!Array<Network.Cookie>>}
     */
    async cookies(...urls) {
      return (await this._client.send('Network.getCookies', {
        urls: urls.length ? urls : [this.url()]
      })).cookies;
    }
  
    /**
     * @param {Array<Protocol.Network.deleteCookiesParameters>} cookies
     */
    async deleteCookie(...cookies) {
      const pageURL = this.url();
      for (const cookie of cookies) {
        const item = Object.assign({}, cookie);
        if (!cookie.url && pageURL.startsWith('http'))
          item.url = pageURL;
        await this._client.send('Network.deleteCookies', item);
      }
    }
  
    /**
     * @param {Array<Network.CookieParam>} cookies
     */
    async setCookie(...cookies) {
      const pageURL = this.url();
      const startsWithHTTP = pageURL.startsWith('http');
      const items = cookies.map(cookie => {
        const item = Object.assign({}, cookie);
        if (!item.url && startsWithHTTP)
          item.url = pageURL;
        assert(item.url !== 'about:blank', `Blank page can not have cookie "${item.name}"`);
        assert(!String.prototype.startsWith.call(item.url || '', 'data:'), `Data URL page can not have cookie "${item.name}"`);
        return item;
      });
      await this.deleteCookie(...items);
      if (items.length)
        await this._client.send('Network.setCookies', { cookies: items });
    }
  
    /**
     * @param {!{url?: string, path?: string, content?: string, type?: string}} options
     * @return {!Promise<!Puppeteer.ElementHandle>}
     */
    async addScriptTag(options) {
      return this.mainFrame().addScriptTag(options);
    }
  
    /**
     * @param {!{url?: string, path?: string, content?: string}} options
     * @return {!Promise<!Puppeteer.ElementHandle>}
     */
    async addStyleTag(options) {
      return this.mainFrame().addStyleTag(options);
    }
  
    /**
     * @param {string} name
     * @param {Function} puppeteerFunction
     */
    async exposeFunction(name, puppeteerFunction) {
      if (this._pageBindings.has(name))
        throw new Error(`Failed to add page binding with name ${name}: window['${name}'] already exists!`);
      this._pageBindings.set(name, puppeteerFunction);
  
      const expression = helper.evaluationString(addPageBinding, name);
      await this._client.send('Runtime.addBinding', {name: name});
      await this._client.send('Page.addScriptToEvaluateOnNewDocument', {source: expression});
      await Promise.all(this.frames().map(frame => frame.evaluate(expression).catch(debugError)));
  
      function addPageBinding(bindingName) {
        const binding = window[bindingName];
        window[bindingName] = (...args) => {
          const me = window[bindingName];
          let callbacks = me['callbacks'];
          if (!callbacks) {
            callbacks = new Map();
            me['callbacks'] = callbacks;
          }
          const seq = (me['lastSeq'] || 0) + 1;
          me['lastSeq'] = seq;
          const promise = new Promise((resolve, reject) => callbacks.set(seq, {resolve, reject}));
          binding(JSON.stringify({name: bindingName, seq, args}));
          return promise;
        };
      }
    }
  
    /**
     * @param {?{username: string, password: string}} credentials
     */
    async authenticate(credentials) {
      return this._frameManager.networkManager().authenticate(credentials);
    }
  
    /**
     * @param {!Object<string, string>} headers
     */
    async setExtraHTTPHeaders(headers) {
      return this._frameManager.networkManager().setExtraHTTPHeaders(headers);
    }
  
    /**
     * @param {string} userAgent
     */
    async setUserAgent(userAgent) {
      return this._frameManager.networkManager().setUserAgent(userAgent);
    }
  
    /**
     * @return {!Promise<!Metrics>}
     */
    async metrics() {
      const response = await this._client.send('Performance.getMetrics');
      return this._buildMetricsObject(response.metrics);
    }
  
    /**
     * @param {!Protocol.Performance.metricsPayload} event
     */
    _emitMetrics(event) {
      this.emit(Events.Page.Metrics, {
        title: event.title,
        metrics: this._buildMetricsObject(event.metrics)
      });
    }
  
    /**
     * @param {?Array<!Protocol.Performance.Metric>} metrics
     * @return {!Metrics}
     */
    _buildMetricsObject(metrics) {
      const result = {};
      for (const metric of metrics || []) {
        if (supportedMetrics.has(metric.name))
          result[metric.name] = metric.value;
      }
      return result;
    }
  
    /**
     * @param {!Protocol.Runtime.ExceptionDetails} exceptionDetails
     */
    _handleException(exceptionDetails) {
      const message = helper.getExceptionMessage(exceptionDetails);
      const err = new Error(message);
      err.stack = ''; // Don't report clientside error with a node stack attached
      this.emit(Events.Page.PageError, err);
    }
  
    /**
     * @param {!Protocol.Runtime.consoleAPICalledPayload} event
     */
    async _onConsoleAPI(event) {
      if (event.executionContextId === 0) {
        // DevTools protocol stores the last 1000 console messages. These
        // messages are always reported even for removed execution contexts. In
        // this case, they are marked with executionContextId = 0 and are
        // reported upon enabling Runtime agent.
        //
        // Ignore these messages since:
        // - there's no execution context we can use to operate with message
        //   arguments
        // - these messages are reported before Puppeteer clients can subscribe
        //   to the 'console'
        //   page event.
        //
        // @see https://github.com/puppeteer/puppeteer/issues/3865
        return;
      }
      const context = this._frameManager.executionContextById(event.executionContextId);
      const values = event.args.map(arg => createJSHandle(context, arg));
      this._addConsoleMessage(event.type, values, event.stackTrace);
    }
  
    /**
     * @param {!Protocol.Runtime.bindingCalledPayload} event
     */
    async _onBindingCalled(event) {
      const {name, seq, args} = JSON.parse(event.payload);
      let expression = null;
      try {
        const result = await this._pageBindings.get(name)(...args);
        expression = helper.evaluationString(deliverResult, name, seq, result);
      } catch (error) {
        if (error instanceof Error)
          expression = helper.evaluationString(deliverError, name, seq, error.message, error.stack);
        else
          expression = helper.evaluationString(deliverErrorValue, name, seq, error);
      }
      this._client.send('Runtime.evaluate', { expression, contextId: event.executionContextId }).catch(debugError);
  
      /**
       * @param {string} name
       * @param {number} seq
       * @param {*} result
       */
      function deliverResult(name, seq, result) {
        window[name]['callbacks'].get(seq).resolve(result);
        window[name]['callbacks'].delete(seq);
      }
  
      /**
       * @param {string} name
       * @param {number} seq
       * @param {string} message
       * @param {string} stack
       */
      function deliverError(name, seq, message, stack) {
        const error = new Error(message);
        error.stack = stack;
        window[name]['callbacks'].get(seq).reject(error);
        window[name]['callbacks'].delete(seq);
      }
  
      /**
       * @param {string} name
       * @param {number} seq
       * @param {*} value
       */
      function deliverErrorValue(name, seq, value) {
        window[name]['callbacks'].get(seq).reject(value);
        window[name]['callbacks'].delete(seq);
      }
    }
  
    /**
     * @param {string} type
     * @param {!Array<!Puppeteer.JSHandle>} args
     * @param {Protocol.Runtime.StackTrace=} stackTrace
     */
    _addConsoleMessage(type, args, stackTrace) {
      if (!this.listenerCount(Events.Page.Console)) {
        args.forEach(arg => arg.dispose());
        return;
      }
      const textTokens = [];
      for (const arg of args) {
        const remoteObject = arg._remoteObject;
        if (remoteObject.objectId)
          textTokens.push(arg.toString());
        else
          textTokens.push(helper.valueFromRemoteObject(remoteObject));
      }
      const location = stackTrace && stackTrace.callFrames.length ? {
        url: stackTrace.callFrames[0].url,
        lineNumber: stackTrace.callFrames[0].lineNumber,
        columnNumber: stackTrace.callFrames[0].columnNumber,
      } : {};
      const message = new ConsoleMessage(type, textTokens.join(' '), args, location);
      this.emit(Events.Page.Console, message);
    }
  
    _onDialog(event) {
      let dialogType = null;
      if (event.type === 'alert')
        dialogType = Dialog.Type.Alert;
      else if (event.type === 'confirm')
        dialogType = Dialog.Type.Confirm;
      else if (event.type === 'prompt')
        dialogType = Dialog.Type.Prompt;
      else if (event.type === 'beforeunload')
        dialogType = Dialog.Type.BeforeUnload;
      assert(dialogType, 'Unknown javascript dialog type: ' + event.type);
      const dialog = new Dialog(this._client, dialogType, event.message, event.defaultPrompt);
      this.emit(Events.Page.Dialog, dialog);
    }
  
    /**
     * @return {!string}
     */
    url() {
      return this.mainFrame().url();
    }
  
    /**
     * @return {!Promise<string>}
     */
    async content() {
      return await this._frameManager.mainFrame().content();
    }
  
    /**
     * @param {string} html
     * @param {!{timeout?: number, waitUntil?: string|!Array<string>}=} options
     */
    async setContent(html, options) {
      await this._frameManager.mainFrame().setContent(html, options);
    }
  
    /**
     * @param {string} url
     * @param {!{referer?: string, timeout?: number, waitUntil?: string|!Array<string>}=} options
     * @return {!Promise<?Puppeteer.Response>}
     */
    async goto(url, options) {
      return await this._frameManager.mainFrame().goto(url, options);
    }
  
    /**
     * @param {!{timeout?: number, waitUntil?: string|!Array<string>}=} options
     * @return {!Promise<?Puppeteer.Response>}
     */
    async reload(options) {
      const [response] = await Promise.all([
        this.waitForNavigation(options),
        this._client.send('Page.reload')
      ]);
      return response;
    }
  
    /**
     * @param {!{timeout?: number, waitUntil?: string|!Array<string>}=} options
     * @return {!Promise<?Puppeteer.Response>}
     */
    async waitForNavigation(options = {}) {
      return await this._frameManager.mainFrame().waitForNavigation(options);
    }
  
    _sessionClosePromise() {
      if (!this._disconnectPromise)
        this._disconnectPromise = new Promise(fulfill => this._client.once(Events.CDPSession.Disconnected, () => fulfill(new Error('Target closed'))));
      return this._disconnectPromise;
    }
  
    /**
     * @param {(string|Function)} urlOrPredicate
     * @param {!{timeout?: number}=} options
     * @return {!Promise<!Puppeteer.Request>}
     */
    async waitForRequest(urlOrPredicate, options = {}) {
      const {
        timeout = this._timeoutSettings.timeout(),
      } = options;
      return helper.waitForEvent(this._frameManager.networkManager(), Events.NetworkManager.Request, request => {
        if (helper.isString(urlOrPredicate))
          return (urlOrPredicate === request.url());
        if (typeof urlOrPredicate === 'function')
          return !!(urlOrPredicate(request));
        return false;
      }, timeout, this._sessionClosePromise());
    }
  
    /**
     * @param {(string|Function)} urlOrPredicate
     * @param {!{timeout?: number}=} options
     * @return {!Promise<!Puppeteer.Response>}
     */
    async waitForResponse(urlOrPredicate, options = {}) {
      const {
        timeout = this._timeoutSettings.timeout(),
      } = options;
      return helper.waitForEvent(this._frameManager.networkManager(), Events.NetworkManager.Response, response => {
        if (helper.isString(urlOrPredicate))
          return (urlOrPredicate === response.url());
        if (typeof urlOrPredicate === 'function')
          return !!(urlOrPredicate(response));
        return false;
      }, timeout, this._sessionClosePromise());
    }
  
    /**
     * @param {!{timeout?: number, waitUntil?: string|!Array<string>}=} options
     * @return {!Promise<?Puppeteer.Response>}
     */
    async goBack(options) {
      return this._go(-1, options);
    }
  
    /**
     * @param {!{timeout?: number, waitUntil?: string|!Array<string>}=} options
     * @return {!Promise<?Puppeteer.Response>}
     */
    async goForward(options) {
      return this._go(+1, options);
    }
  
    /**
     * @param {!{timeout?: number, waitUntil?: string|!Array<string>}=} options
     * @return {!Promise<?Puppeteer.Response>}
     */
    async _go(delta, options) {
      const history = await this._client.send('Page.getNavigationHistory');
      const entry = history.entries[history.currentIndex + delta];
      if (!entry)
        return null;
      const [response] = await Promise.all([
        this.waitForNavigation(options),
        this._client.send('Page.navigateToHistoryEntry', {entryId: entry.id}),
      ]);
      return response;
    }
  
    async bringToFront() {
      await this._client.send('Page.bringToFront');
    }
  
    /**
     * @param {!{viewport: !Puppeteer.Viewport, userAgent: string}} options
     */
    async emulate(options) {
      await Promise.all([
        this.setViewport(options.viewport),
        this.setUserAgent(options.userAgent)
      ]);
    }
  
    /**
     * @param {boolean} enabled
     */
    async setJavaScriptEnabled(enabled) {
      if (this._javascriptEnabled === enabled)
        return;
      this._javascriptEnabled = enabled;
      await this._client.send('Emulation.setScriptExecutionDisabled', { value: !enabled });
    }
  
    /**
     * @param {boolean} enabled
     */
    async setBypassCSP(enabled) {
      await this._client.send('Page.setBypassCSP', { enabled });
    }
  
    /**
     * @param {?string} type
     */
    async emulateMediaType(type) {
      assert(type === 'screen' || type === 'print' || type === null, 'Unsupported media type: ' + type);
      await this._client.send('Emulation.setEmulatedMedia', {media: type || ''});
    }
  
    /**
     * @param {?Array<MediaFeature>} features
     */
    async emulateMediaFeatures(features) {
      if (features === null)
        await this._client.send('Emulation.setEmulatedMedia', {features: null});
      if (Array.isArray(features)) {
        features.every(mediaFeature => {
          const name = mediaFeature.name;
          assert(/^prefers-(?:color-scheme|reduced-motion)$/.test(name), 'Unsupported media feature: ' + name);
          return true;
        });
        await this._client.send('Emulation.setEmulatedMedia', {features: features});
      }
    }
  
    /**
     * @param {?string} timezoneId
     */
    async emulateTimezone(timezoneId) {
      try {
        await this._client.send('Emulation.setTimezoneOverride', {timezoneId: timezoneId || ''});
      } catch (exception) {
        if (exception.message.includes('Invalid timezone'))
          throw new Error(`Invalid timezone ID: ${timezoneId}`);
        throw exception;
      }
    }
  
    /**
     * @param {!Puppeteer.Viewport} viewport
     */
    async setViewport(viewport) {
      const needsReload = await this._emulationManager.emulateViewport(viewport);
      this._viewport = viewport;
      if (needsReload)
        await this.reload();
    }
  
    /**
     * @return {?Puppeteer.Viewport}
     */
    viewport() {
      return this._viewport;
    }
  
    /**
     * @param {Function|string} pageFunction
     * @param {!Array<*>} args
     * @return {!Promise<*>}
     */
    async evaluate(pageFunction, ...args) {
      return this._frameManager.mainFrame().evaluate(pageFunction, ...args);
    }
  
    /**
     * @param {Function|string} pageFunction
     * @param {!Array<*>} args
     */
    async evaluateOnNewDocument(pageFunction, ...args) {
      const source = helper.evaluationString(pageFunction, ...args);
      await this._client.send('Page.addScriptToEvaluateOnNewDocument', { source });
    }
  
    /**
     * @param {boolean} enabled
     */
    async setCacheEnabled(enabled = true) {
      await this._frameManager.networkManager().setCacheEnabled(enabled);
    }
  
    /**
     * @param {!ScreenshotOptions=} options
     * @return {!Promise<!Buffer|!String>}
     */
    async screenshot(options = {}) {
      let screenshotType = null;
      // options.type takes precedence over inferring the type from options.path
      // because it may be a 0-length file with no extension created beforehand (i.e. as a temp file).
      if (options.type) {
        assert(options.type === 'png' || options.type === 'jpeg', 'Unknown options.type value: ' + options.type);
        screenshotType = options.type;
      } else if (options.path) {
        const mimeType = mime.getType(options.path);
        if (mimeType === 'image/png')
          screenshotType = 'png';
        else if (mimeType === 'image/jpeg')
          screenshotType = 'jpeg';
        assert(screenshotType, 'Unsupported screenshot mime type: ' + mimeType);
      }
  
      if (!screenshotType)
        screenshotType = 'png';
  
      if (options.quality) {
        assert(screenshotType === 'jpeg', 'options.quality is unsupported for the ' + screenshotType + ' screenshots');
        assert(typeof options.quality === 'number', 'Expected options.quality to be a number but found ' + (typeof options.quality));
        assert(Number.isInteger(options.quality), 'Expected options.quality to be an integer');
        assert(options.quality >= 0 && options.quality <= 100, 'Expected options.quality to be between 0 and 100 (inclusive), got ' + options.quality);
      }
      assert(!options.clip || !options.fullPage, 'options.clip and options.fullPage are exclusive');
      if (options.clip) {
        assert(typeof options.clip.x === 'number', 'Expected options.clip.x to be a number but found ' + (typeof options.clip.x));
        assert(typeof options.clip.y === 'number', 'Expected options.clip.y to be a number but found ' + (typeof options.clip.y));
        assert(typeof options.clip.width === 'number', 'Expected options.clip.width to be a number but found ' + (typeof options.clip.width));
        assert(typeof options.clip.height === 'number', 'Expected options.clip.height to be a number but found ' + (typeof options.clip.height));
        assert(options.clip.width !== 0, 'Expected options.clip.width not to be 0.');
        assert(options.clip.height !== 0, 'Expected options.clip.height not to be 0.');
      }
      return this._screenshotTaskQueue.postTask(this._screenshotTask.bind(this, screenshotType, options));
    }
  
    /**
     * @param {"png"|"jpeg"} format
     * @param {!ScreenshotOptions=} options
     * @return {!Promise<!Buffer|!String>}
     */
    async _screenshotTask(format, options) {
      await this._client.send('Target.activateTarget', {targetId: this._target._targetId});
      let clip = options.clip ? processClip(options.clip) : undefined;
  
      if (options.fullPage) {
        const metrics = await this._client.send('Page.getLayoutMetrics');
        const width = Math.ceil(metrics.contentSize.width);
        const height = Math.ceil(metrics.contentSize.height);
  
        // Overwrite clip for full page at all times.
        clip = { x: 0, y: 0, width, height, scale: 1 };
        const {
          isMobile = false,
          deviceScaleFactor = 1,
          isLandscape = false
        } = this._viewport || {};
        /** @type {!Protocol.Emulation.ScreenOrientation} */
        const screenOrientation = isLandscape ? { angle: 90, type: 'landscapePrimary' } : { angle: 0, type: 'portraitPrimary' };
        await this._client.send('Emulation.setDeviceMetricsOverride', { mobile: isMobile, width, height, deviceScaleFactor, screenOrientation });
      }
      const shouldSetDefaultBackground = options.omitBackground && format === 'png';
      if (shouldSetDefaultBackground)
        await this._client.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
      const result = await this._client.send('Page.captureScreenshot', { format, quality: options.quality, clip });
      if (shouldSetDefaultBackground)
        await this._client.send('Emulation.setDefaultBackgroundColorOverride');
  
      if (options.fullPage && this._viewport)
        await this.setViewport(this._viewport);
  
      const buffer = options.encoding === 'base64' ? result.data : Buffer.from(result.data, 'base64');
      if (options.path)
        await writeFileAsync(options.path, buffer);
      return buffer;
  
      function processClip(clip) {
        const x = Math.round(clip.x);
        const y = Math.round(clip.y);
        const width = Math.round(clip.width + clip.x - x);
        const height = Math.round(clip.height + clip.y - y);
        return {x, y, width, height, scale: 1};
      }
    }
  
    /**
     * @param {!PDFOptions=} options
     * @return {!Promise<!Buffer>}
     */
    async pdf(options = {}) {
      const {
        scale = 1,
        displayHeaderFooter = false,
        headerTemplate = '',
        footerTemplate = '',
        printBackground = false,
        landscape = false,
        pageRanges = '',
        preferCSSPageSize = false,
        margin = {},
        path = null
      } = options;
  
      let paperWidth = 8.5;
      let paperHeight = 11;
      if (options.format) {
        const format = Page.PaperFormats[options.format.toLowerCase()];
        assert(format, 'Unknown paper format: ' + options.format);
        paperWidth = format.width;
        paperHeight = format.height;
      } else {
        paperWidth = convertPrintParameterToInches(options.width) || paperWidth;
        paperHeight = convertPrintParameterToInches(options.height) || paperHeight;
      }
  
      const marginTop = convertPrintParameterToInches(margin.top) || 0;
      const marginLeft = convertPrintParameterToInches(margin.left) || 0;
      const marginBottom = convertPrintParameterToInches(margin.bottom) || 0;
      const marginRight = convertPrintParameterToInches(margin.right) || 0;
  
      const result = await this._client.send('Page.printToPDF', {
        transferMode: 'ReturnAsStream',
        landscape,
        displayHeaderFooter,
        headerTemplate,
        footerTemplate,
        printBackground,
        scale,
        paperWidth,
        paperHeight,
        marginTop,
        marginBottom,
        marginLeft,
        marginRight,
        pageRanges,
        preferCSSPageSize
      });
      return await helper.readProtocolStream(this._client, result.stream, path);
    }
  
    /**
     * @return {!Promise<string>}
     */
    async title() {
      return this.mainFrame().title();
    }
  
    /**
     * @param {!{runBeforeUnload: (boolean|undefined)}=} options
     */
    async close(options = {runBeforeUnload: undefined}) {
      assert(!!this._client._connection, 'Protocol error: Connection closed. Most likely the page has been closed.');
      const runBeforeUnload = !!options.runBeforeUnload;
      if (runBeforeUnload) {
        await this._client.send('Page.close');
      } else {
        await this._client._connection.send('Target.closeTarget', { targetId: this._target._targetId });
        await this._target._isClosedPromise;
      }
    }
  
    /**
     * @return {boolean}
     */
    isClosed() {
      return this._closed;
    }
  
    /**
     * @return {!Mouse}
     */
    get mouse() {
      return this._mouse;
    }
  
    /**
     * @param {string} selector
     * @param {!{delay?: number, button?: "left"|"right"|"middle", clickCount?: number}=} options
     */
    click(selector, options = {}) {
      return this.mainFrame().click(selector, options);
    }
  
    /**
     * @param {string} selector
     */
    focus(selector) {
      return this.mainFrame().focus(selector);
    }
  
    /**
     * @param {string} selector
     */
    hover(selector) {
      return this.mainFrame().hover(selector);
    }
  
    /**
     * @param {string} selector
     * @param {!Array<string>} values
     * @return {!Promise<!Array<string>>}
     */
    select(selector, ...values) {
      return this.mainFrame().select(selector, ...values);
    }
  
    /**
     * @param {string} selector
     */
    tap(selector) {
      return this.mainFrame().tap(selector);
    }
  
    /**
     * @param {string} selector
     * @param {string} text
     * @param {{delay: (number|undefined)}=} options
     */
    type(selector, text, options) {
      return this.mainFrame().type(selector, text, options);
    }
  
    /**
     * @param {(string|number|Function)} selectorOrFunctionOrTimeout
     * @param {!{visible?: boolean, hidden?: boolean, timeout?: number, polling?: string|number}=} options
     * @param {!Array<*>} args
     * @return {!Promise<!Puppeteer.JSHandle>}
     */
    waitFor(selectorOrFunctionOrTimeout, options = {}, ...args) {
      return this.mainFrame().waitFor(selectorOrFunctionOrTimeout, options, ...args);
    }
  
    /**
     * @param {string} selector
     * @param {!{visible?: boolean, hidden?: boolean, timeout?: number}=} options
     * @return {!Promise<?Puppeteer.ElementHandle>}
     */
    waitForSelector(selector, options = {}) {
      return this.mainFrame().waitForSelector(selector, options);
    }
  
    /**
     * @param {string} xpath
     * @param {!{visible?: boolean, hidden?: boolean, timeout?: number}=} options
     * @return {!Promise<?Puppeteer.ElementHandle>}
     */
    waitForXPath(xpath, options = {}) {
      return this.mainFrame().waitForXPath(xpath, options);
    }
  
    /**
     * @param {Function} pageFunction
     * @param {!{polling?: string|number, timeout?: number}=} options
     * @param {!Array<*>} args
     * @return {!Promise<!Puppeteer.JSHandle>}
     */
    waitForFunction(pageFunction, options = {}, ...args) {
      return this.mainFrame().waitForFunction(pageFunction, options, ...args);
    }
  }
  
  // Expose alias for deprecated method.
  Page.prototype.emulateMedia = Page.prototype.emulateMediaType;
  
  /**
   * @typedef {Object} PDFOptions
   * @property {number=} scale
   * @property {boolean=} displayHeaderFooter
   * @property {string=} headerTemplate
   * @property {string=} footerTemplate
   * @property {boolean=} printBackground
   * @property {boolean=} landscape
   * @property {string=} pageRanges
   * @property {string=} format
   * @property {string|number=} width
   * @property {string|number=} height
   * @property {boolean=} preferCSSPageSize
   * @property {!{top?: string|number, bottom?: string|number, left?: string|number, right?: string|number}=} margin
   * @property {string=} path
   */
  
  /**
   * @typedef {Object} Metrics
   * @property {number=} Timestamp
   * @property {number=} Documents
   * @property {number=} Frames
   * @property {number=} JSEventListeners
   * @property {number=} Nodes
   * @property {number=} LayoutCount
   * @property {number=} RecalcStyleCount
   * @property {number=} LayoutDuration
   * @property {number=} RecalcStyleDuration
   * @property {number=} ScriptDuration
   * @property {number=} TaskDuration
   * @property {number=} JSHeapUsedSize
   * @property {number=} JSHeapTotalSize
   */
  
  /**
   * @typedef {Object} ScreenshotOptions
   * @property {string=} type
   * @property {string=} path
   * @property {boolean=} fullPage
   * @property {{x: number, y: number, width: number, height: number}=} clip
   * @property {number=} quality
   * @property {boolean=} omitBackground
   * @property {string=} encoding
   */
  
  /**
   * @typedef {Object} MediaFeature
   * @property {string} name
   * @property {string} value
   */
  
  /** @type {!Set<string>} */
  const supportedMetrics = new Set([
    'Timestamp',
    'Documents',
    'Frames',
    'JSEventListeners',
    'Nodes',
    'LayoutCount',
    'RecalcStyleCount',
    'LayoutDuration',
    'RecalcStyleDuration',
    'ScriptDuration',
    'TaskDuration',
    'JSHeapUsedSize',
    'JSHeapTotalSize',
  ]);
  
  /** @enum {!{width: number, height: number}} */
  Page.PaperFormats = {
    letter: {width: 8.5, height: 11},
    legal: {width: 8.5, height: 14},
    tabloid: {width: 11, height: 17},
    ledger: {width: 17, height: 11},
    a0: {width: 33.1, height: 46.8 },
    a1: {width: 23.4, height: 33.1 },
    a2: {width: 16.54, height: 23.4 },
    a3: {width: 11.7, height: 16.54 },
    a4: {width: 8.27, height: 11.7 },
    a5: {width: 5.83, height: 8.27 },
    a6: {width: 4.13, height: 5.83 },
  };
  
  const unitToPixels = {
    'px': 1,
    'in': 96,
    'cm': 37.8,
    'mm': 3.78
  };
  
  /**
   * @param {(string|number|undefined)} parameter
   * @return {(number|undefined)}
   */
  function convertPrintParameterToInches(parameter) {
    if (typeof parameter === 'undefined')
      return undefined;
    let pixels;
    if (helper.isNumber(parameter)) {
      // Treat numbers as pixel values to be aligned with phantom's paperSize.
      pixels = /** @type {number} */ (parameter);
    } else if (helper.isString(parameter)) {
      const text = /** @type {string} */ (parameter);
      let unit = text.substring(text.length - 2).toLowerCase();
      let valueText = '';
      if (unitToPixels.hasOwnProperty(unit)) {
        valueText = text.substring(0, text.length - 2);
      } else {
        // In case of unknown unit try to parse the whole parameter as number of pixels.
        // This is consistent with phantom's paperSize behavior.
        unit = 'px';
        valueText = text;
      }
      const value = Number(valueText);
      assert(!isNaN(value), 'Failed to parse parameter value: ' + text);
      pixels = value * unitToPixels[unit];
    } else {
      throw new Error('page.pdf() Cannot handle parameter type: ' + (typeof parameter));
    }
    return pixels / 96;
  }
  
  /**
   * @typedef {Object} Network.Cookie
   * @property {string} name
   * @property {string} value
   * @property {string} domain
   * @property {string} path
   * @property {number} expires
   * @property {number} size
   * @property {boolean} httpOnly
   * @property {boolean} secure
   * @property {boolean} session
   * @property {("Strict"|"Lax"|"Extended"|"None")=} sameSite
   */
  
  
  /**
   * @typedef {Object} Network.CookieParam
   * @property {string} name
   * @property {string} value
   * @property {string=} url
   * @property {string=} domain
   * @property {string=} path
   * @property {number=} expires
   * @property {boolean=} httpOnly
   * @property {boolean=} secure
   * @property {("Strict"|"Lax")=} sameSite
   */
  
  /**
   * @typedef {Object} ConsoleMessage.Location
   * @property {string=} url
   * @property {number=} lineNumber
   * @property {number=} columnNumber
   */
  
  class ConsoleMessage {
    /**
     * @param {string} type
     * @param {string} text
     * @param {!Array<!Puppeteer.JSHandle>} args
     * @param {ConsoleMessage.Location} location
     */
    constructor(type, text, args, location = {}) {
      this._type = type;
      this._text = text;
      this._args = args;
      this._location = location;
    }
  
    /**
     * @return {string}
     */
    type() {
      return this._type;
    }
  
    /**
     * @return {string}
     */
    text() {
      return this._text;
    }
  
    /**
     * @return {!Array<!Puppeteer.JSHandle>}
     */
    args() {
      return this._args;
    }
  
    /**
     * @return {Object}
     */
    location() {
      return this._location;
    }
  }
  
  class FileChooser {
    /**
     * @param {Puppeteer.CDPSession} client
     * @param {Puppeteer.ElementHandle} element
     * @param {!Protocol.Page.fileChooserOpenedPayload} event
     */
    constructor(client, element, event) {
      this._client = client;
      this._element = element;
      this._multiple = event.mode !== 'selectSingle';
      this._handled = false;
    }
  
    /**
     * @return {boolean}
     */
    isMultiple() {
      return this._multiple;
    }
  
    /**
     * @param {!Array<string>} filePaths
     * @return {!Promise}
     */
    async accept(filePaths) {
      assert(!this._handled, 'Cannot accept FileChooser which is already handled!');
      this._handled = true;
      await this._element.uploadFile(...filePaths);
    }
  
    /**
     * @return {!Promise}
     */
    async cancel() {
      assert(!this._handled, 'Cannot cancel FileChooser which is already handled!');
      this._handled = true;
    }
  }
  
  module.exports = {Page, ConsoleMessage, FileChooser};
  
  }).call(this)}).call(this,require("buffer").Buffer)
  },{"./Accessibility":41,"./Connection":43,"./Coverage":44,"./Dialog":47,"./EmulationManager":48,"./Events":50,"./FrameManager":52,"./Input":53,"./JSHandle":54,"./TimeoutSettings":63,"./Tracing":64,"./Worker":67,"./helper":69,"buffer":3,"events":5,"fs":2,"mime":76}],59:[function(require,module,exports){
  /**
   * Copyright 2018 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  const {helper, debugError} = require('./helper');
  
  /**
   * @implements {!Puppeteer.ConnectionTransport}
   */
  class PipeTransport {
    /**
     * @param {!NodeJS.WritableStream} pipeWrite
     * @param {!NodeJS.ReadableStream} pipeRead
     */
    constructor(pipeWrite, pipeRead) {
      this._pipeWrite = pipeWrite;
      this._pendingMessage = '';
      this._eventListeners = [
        helper.addEventListener(pipeRead, 'data', buffer => this._dispatch(buffer)),
        helper.addEventListener(pipeRead, 'close', () => {
          if (this.onclose)
            this.onclose.call(null);
        }),
        helper.addEventListener(pipeRead, 'error', debugError),
        helper.addEventListener(pipeWrite, 'error', debugError),
      ];
      this.onmessage = null;
      this.onclose = null;
    }
  
    /**
     * @param {string} message
     */
    send(message) {
      this._pipeWrite.write(message);
      this._pipeWrite.write('\0');
    }
  
    /**
     * @param {!Buffer} buffer
     */
    _dispatch(buffer) {
      let end = buffer.indexOf('\0');
      if (end === -1) {
        this._pendingMessage += buffer.toString();
        return;
      }
      const message = this._pendingMessage + buffer.toString(undefined, 0, end);
      if (this.onmessage)
        this.onmessage.call(null, message);
  
      let start = end + 1;
      end = buffer.indexOf('\0', start);
      while (end !== -1) {
        if (this.onmessage)
          this.onmessage.call(null, buffer.toString(undefined, start, end));
        start = end + 1;
        end = buffer.indexOf('\0', start);
      }
      this._pendingMessage = buffer.toString(undefined, start);
    }
  
    close() {
      this._pipeWrite = null;
      helper.removeEventListeners(this._eventListeners);
    }
  }
  
  module.exports = PipeTransport;
  
  },{"./helper":69}],60:[function(require,module,exports){
  /**
   * Copyright 2017 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  const Launcher = require('./Launcher');
  const BrowserFetcher = require('./BrowserFetcher');
  const Errors = require('./Errors');
  const DeviceDescriptors = require('./DeviceDescriptors');
  
  module.exports = class {
    /**
     * @param {string} projectRoot
     * @param {string} preferredRevision
     * @param {boolean} isPuppeteerCore
     */
    constructor(projectRoot, preferredRevision, isPuppeteerCore) {
      this._projectRoot = projectRoot;
      this._preferredRevision = preferredRevision;
      this._isPuppeteerCore = isPuppeteerCore;
    }
  
    /**
     * @param {!(Launcher.LaunchOptions & Launcher.ChromeArgOptions & Launcher.BrowserOptions & {product?: string, extraPrefsFirefox?: !object})=} options
     * @return {!Promise<!Puppeteer.Browser>}
     */
    launch(options) {
      if (!this._productName && options)
        this._productName = options.product;
      return this._launcher.launch(options);
    }
  
    /**
     * @param {!(Launcher.BrowserOptions & {browserWSEndpoint?: string, browserURL?: string, transport?: !Puppeteer.ConnectionTransport})} options
     * @return {!Promise<!Puppeteer.Browser>}
     */
    connect(options) {
      return this._launcher.connect(options);
    }
  
    /**
     * @return {string}
     */
    executablePath() {
      return this._launcher.executablePath();
    }
  
    /**
     * @return {!Puppeteer.ProductLauncher}
     */
    get _launcher() {
      if (!this._lazyLauncher)
        this._lazyLauncher = Launcher(this._projectRoot, this._preferredRevision, this._isPuppeteerCore, this._productName);
      return this._lazyLauncher;
  
    }
  
    /**
     * @return {string}
     */
    get product() {
      return this._launcher.product;
    }
  
    /**
     * @return {Object}
     */
    get devices() {
      return DeviceDescriptors;
    }
  
    /**
     * @return {Object}
     */
    get errors() {
      return Errors;
    }
  
    /**
     * @param {!Launcher.ChromeArgOptions=} options
     * @return {!Array<string>}
     */
    defaultArgs(options) {
      return this._launcher.defaultArgs(options);
    }
  
    /**
     * @param {!BrowserFetcher.Options=} options
     * @return {!BrowserFetcher}
     */
    createBrowserFetcher(options) {
      return new BrowserFetcher(this._projectRoot, options);
    }
  };
  
  
  },{"./BrowserFetcher":2,"./DeviceDescriptors":46,"./Errors":49,"./Launcher":55}],61:[function(require,module,exports){
  /**
   * Copyright 2019 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  
  const {Events} = require('./Events');
  const {Page} = require('./Page');
  const {Worker} = require('./Worker');
  
  class Target {
    /**
     * @param {!Protocol.Target.TargetInfo} targetInfo
     * @param {!Puppeteer.BrowserContext} browserContext
     * @param {!function():!Promise<!Puppeteer.CDPSession>} sessionFactory
     * @param {boolean} ignoreHTTPSErrors
     * @param {?Puppeteer.Viewport} defaultViewport
     * @param {!Puppeteer.TaskQueue} screenshotTaskQueue
     */
    constructor(targetInfo, browserContext, sessionFactory, ignoreHTTPSErrors, defaultViewport, screenshotTaskQueue) {
      this._targetInfo = targetInfo;
      this._browserContext = browserContext;
      this._targetId = targetInfo.targetId;
      this._sessionFactory = sessionFactory;
      this._ignoreHTTPSErrors = ignoreHTTPSErrors;
      this._defaultViewport = defaultViewport;
      this._screenshotTaskQueue = screenshotTaskQueue;
      /** @type {?Promise<!Puppeteer.Page>} */
      this._pagePromise = null;
      /** @type {?Promise<!Worker>} */
      this._workerPromise = null;
      this._initializedPromise = new Promise(fulfill => this._initializedCallback = fulfill).then(async success => {
        if (!success)
          return false;
        const opener = this.opener();
        if (!opener || !opener._pagePromise || this.type() !== 'page')
          return true;
        const openerPage = await opener._pagePromise;
        if (!openerPage.listenerCount(Events.Page.Popup))
          return true;
        const popupPage = await this.page();
        openerPage.emit(Events.Page.Popup, popupPage);
        return true;
      });
      this._isClosedPromise = new Promise(fulfill => this._closedCallback = fulfill);
      this._isInitialized = this._targetInfo.type !== 'page' || this._targetInfo.url !== '';
      if (this._isInitialized)
        this._initializedCallback(true);
    }
  
    /**
     * @return {!Promise<!Puppeteer.CDPSession>}
     */
    createCDPSession() {
      return this._sessionFactory();
    }
  
    /**
     * @return {!Promise<?Page>}
     */
    async page() {
      if ((this._targetInfo.type === 'page' || this._targetInfo.type === 'background_page') && !this._pagePromise) {
        this._pagePromise = this._sessionFactory()
            .then(client => Page.create(client, this, this._ignoreHTTPSErrors, this._defaultViewport, this._screenshotTaskQueue));
      }
      return this._pagePromise;
    }
  
    /**
     * @return {!Promise<?Worker>}
     */
    async worker() {
      if (this._targetInfo.type !== 'service_worker' && this._targetInfo.type !== 'shared_worker')
        return null;
      if (!this._workerPromise) {
        // TODO(einbinder): Make workers send their console logs.
        this._workerPromise = this._sessionFactory()
            .then(client => new Worker(client, this._targetInfo.url, () => {} /* consoleAPICalled */, () => {} /* exceptionThrown */));
      }
      return this._workerPromise;
    }
  
    /**
     * @return {string}
     */
    url() {
      return this._targetInfo.url;
    }
  
    /**
     * @return {"page"|"background_page"|"service_worker"|"shared_worker"|"other"|"browser"}
     */
    type() {
      const type = this._targetInfo.type;
      if (type === 'page' || type === 'background_page' || type === 'service_worker' || type === 'shared_worker' || type === 'browser')
        return type;
      return 'other';
    }
  
    /**
     * @return {!Puppeteer.Browser}
     */
    browser() {
      return this._browserContext.browser();
    }
  
    /**
     * @return {!Puppeteer.BrowserContext}
     */
    browserContext() {
      return this._browserContext;
    }
  
    /**
     * @return {?Puppeteer.Target}
     */
    opener() {
      const { openerId } = this._targetInfo;
      if (!openerId)
        return null;
      return this.browser()._targets.get(openerId);
    }
  
    /**
     * @param {!Protocol.Target.TargetInfo} targetInfo
     */
    _targetInfoChanged(targetInfo) {
      this._targetInfo = targetInfo;
  
      if (!this._isInitialized && (this._targetInfo.type !== 'page' || this._targetInfo.url !== '')) {
        this._isInitialized = true;
        this._initializedCallback(true);
        return;
      }
    }
  }
  
  module.exports = {Target};
  
  },{"./Events":50,"./Page":58,"./Worker":67}],62:[function(require,module,exports){
  class TaskQueue {
    constructor() {
      this._chain = Promise.resolve();
    }
  
    /**
     * @param {Function} task
     * @return {!Promise}
     */
    postTask(task) {
      const result = this._chain.then(task);
      this._chain = result.catch(() => {});
      return result;
    }
  }
  
  module.exports = {TaskQueue};
  },{}],63:[function(require,module,exports){
  /**
   * Copyright 2019 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  
  const DEFAULT_TIMEOUT = 30000;
  
  class TimeoutSettings {
    constructor() {
      this._defaultTimeout = null;
      this._defaultNavigationTimeout = null;
    }
  
    /**
     * @param {number} timeout
     */
    setDefaultTimeout(timeout) {
      this._defaultTimeout = timeout;
    }
  
    /**
     * @param {number} timeout
     */
    setDefaultNavigationTimeout(timeout) {
      this._defaultNavigationTimeout = timeout;
    }
  
    /**
     * @return {number}
     */
    navigationTimeout() {
      if (this._defaultNavigationTimeout !== null)
        return this._defaultNavigationTimeout;
      if (this._defaultTimeout !== null)
        return this._defaultTimeout;
      return DEFAULT_TIMEOUT;
    }
  
    timeout() {
      if (this._defaultTimeout !== null)
        return this._defaultTimeout;
      return DEFAULT_TIMEOUT;
    }
  }
  
  module.exports = {TimeoutSettings};
  
  },{}],64:[function(require,module,exports){
  /**
   * Copyright 2017 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  const {helper, assert} = require('./helper');
  
  class Tracing {
    /**
     * @param {!Puppeteer.CDPSession} client
     */
    constructor(client) {
      this._client = client;
      this._recording = false;
      this._path = '';
    }
  
    /**
     * @param {!{path?: string, screenshots?: boolean, categories?: !Array<string>}} options
     */
    async start(options = {}) {
      assert(!this._recording, 'Cannot start recording trace while already recording trace.');
  
      const defaultCategories = [
        '-*', 'devtools.timeline', 'v8.execute', 'disabled-by-default-devtools.timeline',
        'disabled-by-default-devtools.timeline.frame', 'toplevel',
        'blink.console', 'blink.user_timing', 'latencyInfo', 'disabled-by-default-devtools.timeline.stack',
        'disabled-by-default-v8.cpu_profiler', 'disabled-by-default-v8.cpu_profiler.hires'
      ];
      const {
        path = null,
        screenshots = false,
        categories = defaultCategories,
      } = options;
  
      if (screenshots)
        categories.push('disabled-by-default-devtools.screenshot');
  
      this._path = path;
      this._recording = true;
      await this._client.send('Tracing.start', {
        transferMode: 'ReturnAsStream',
        categories: categories.join(',')
      });
    }
  
    /**
     * @return {!Promise<!Buffer>}
     */
    async stop() {
      let fulfill;
      const contentPromise = new Promise(x => fulfill = x);
      this._client.once('Tracing.tracingComplete', event => {
        helper.readProtocolStream(this._client, event.stream, this._path).then(fulfill);
      });
      await this._client.send('Tracing.end');
      this._recording = false;
      return contentPromise;
    }
  }
  
  module.exports = Tracing;
  
  },{"./helper":69}],65:[function(require,module,exports){
  /**
   * Copyright 2017 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the 'License');
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an 'AS IS' BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  
  /**
   * @typedef {Object} KeyDefinition
   * @property {number=} keyCode
   * @property {number=} shiftKeyCode
   * @property {string=} key
   * @property {string=} shiftKey
   * @property {string=} code
   * @property {string=} text
   * @property {string=} shiftText
   * @property {number=} location
   */
  
  /**
   * @type {Object<string, KeyDefinition>}
   */
  module.exports = {
    '0': {'keyCode': 48, 'key': '0', 'code': 'Digit0'},
    '1': {'keyCode': 49, 'key': '1', 'code': 'Digit1'},
    '2': {'keyCode': 50, 'key': '2', 'code': 'Digit2'},
    '3': {'keyCode': 51, 'key': '3', 'code': 'Digit3'},
    '4': {'keyCode': 52, 'key': '4', 'code': 'Digit4'},
    '5': {'keyCode': 53, 'key': '5', 'code': 'Digit5'},
    '6': {'keyCode': 54, 'key': '6', 'code': 'Digit6'},
    '7': {'keyCode': 55, 'key': '7', 'code': 'Digit7'},
    '8': {'keyCode': 56, 'key': '8', 'code': 'Digit8'},
    '9': {'keyCode': 57, 'key': '9', 'code': 'Digit9'},
    'Power': {'key': 'Power', 'code': 'Power'},
    'Eject': {'key': 'Eject', 'code': 'Eject'},
    'Abort': {'keyCode': 3, 'code': 'Abort', 'key': 'Cancel'},
    'Help': {'keyCode': 6, 'code': 'Help', 'key': 'Help'},
    'Backspace': {'keyCode': 8, 'code': 'Backspace', 'key': 'Backspace'},
    'Tab': {'keyCode': 9, 'code': 'Tab', 'key': 'Tab'},
    'Numpad5': {'keyCode': 12, 'shiftKeyCode': 101, 'key': 'Clear', 'code': 'Numpad5', 'shiftKey': '5', 'location': 3},
    'NumpadEnter': {'keyCode': 13, 'code': 'NumpadEnter', 'key': 'Enter', 'text': '\r', 'location': 3},
    'Enter': {'keyCode': 13, 'code': 'Enter', 'key': 'Enter', 'text': '\r'},
    '\r': {'keyCode': 13, 'code': 'Enter', 'key': 'Enter', 'text': '\r'},
    '\n': {'keyCode': 13, 'code': 'Enter', 'key': 'Enter', 'text': '\r'},
    'ShiftLeft': {'keyCode': 16, 'code': 'ShiftLeft', 'key': 'Shift', 'location': 1},
    'ShiftRight': {'keyCode': 16, 'code': 'ShiftRight', 'key': 'Shift', 'location': 2},
    'ControlLeft': {'keyCode': 17, 'code': 'ControlLeft', 'key': 'Control', 'location': 1},
    'ControlRight': {'keyCode': 17, 'code': 'ControlRight', 'key': 'Control', 'location': 2},
    'AltLeft': {'keyCode': 18, 'code': 'AltLeft', 'key': 'Alt', 'location': 1},
    'AltRight': {'keyCode': 18, 'code': 'AltRight', 'key': 'Alt', 'location': 2},
    'Pause': {'keyCode': 19, 'code': 'Pause', 'key': 'Pause'},
    'CapsLock': {'keyCode': 20, 'code': 'CapsLock', 'key': 'CapsLock'},
    'Escape': {'keyCode': 27, 'code': 'Escape', 'key': 'Escape'},
    'Convert': {'keyCode': 28, 'code': 'Convert', 'key': 'Convert'},
    'NonConvert': {'keyCode': 29, 'code': 'NonConvert', 'key': 'NonConvert'},
    'Space': {'keyCode': 32, 'code': 'Space', 'key': ' '},
    'Numpad9': {'keyCode': 33, 'shiftKeyCode': 105, 'key': 'PageUp', 'code': 'Numpad9', 'shiftKey': '9', 'location': 3},
    'PageUp': {'keyCode': 33, 'code': 'PageUp', 'key': 'PageUp'},
    'Numpad3': {'keyCode': 34, 'shiftKeyCode': 99, 'key': 'PageDown', 'code': 'Numpad3', 'shiftKey': '3', 'location': 3},
    'PageDown': {'keyCode': 34, 'code': 'PageDown', 'key': 'PageDown'},
    'End': {'keyCode': 35, 'code': 'End', 'key': 'End'},
    'Numpad1': {'keyCode': 35, 'shiftKeyCode': 97, 'key': 'End', 'code': 'Numpad1', 'shiftKey': '1', 'location': 3},
    'Home': {'keyCode': 36, 'code': 'Home', 'key': 'Home'},
    'Numpad7': {'keyCode': 36, 'shiftKeyCode': 103, 'key': 'Home', 'code': 'Numpad7', 'shiftKey': '7', 'location': 3},
    'ArrowLeft': {'keyCode': 37, 'code': 'ArrowLeft', 'key': 'ArrowLeft'},
    'Numpad4': {'keyCode': 37, 'shiftKeyCode': 100, 'key': 'ArrowLeft', 'code': 'Numpad4', 'shiftKey': '4', 'location': 3},
    'Numpad8': {'keyCode': 38, 'shiftKeyCode': 104, 'key': 'ArrowUp', 'code': 'Numpad8', 'shiftKey': '8', 'location': 3},
    'ArrowUp': {'keyCode': 38, 'code': 'ArrowUp', 'key': 'ArrowUp'},
    'ArrowRight': {'keyCode': 39, 'code': 'ArrowRight', 'key': 'ArrowRight'},
    'Numpad6': {'keyCode': 39, 'shiftKeyCode': 102, 'key': 'ArrowRight', 'code': 'Numpad6', 'shiftKey': '6', 'location': 3},
    'Numpad2': {'keyCode': 40, 'shiftKeyCode': 98, 'key': 'ArrowDown', 'code': 'Numpad2', 'shiftKey': '2', 'location': 3},
    'ArrowDown': {'keyCode': 40, 'code': 'ArrowDown', 'key': 'ArrowDown'},
    'Select': {'keyCode': 41, 'code': 'Select', 'key': 'Select'},
    'Open': {'keyCode': 43, 'code': 'Open', 'key': 'Execute'},
    'PrintScreen': {'keyCode': 44, 'code': 'PrintScreen', 'key': 'PrintScreen'},
    'Insert': {'keyCode': 45, 'code': 'Insert', 'key': 'Insert'},
    'Numpad0': {'keyCode': 45, 'shiftKeyCode': 96, 'key': 'Insert', 'code': 'Numpad0', 'shiftKey': '0', 'location': 3},
    'Delete': {'keyCode': 46, 'code': 'Delete', 'key': 'Delete'},
    'NumpadDecimal': {'keyCode': 46, 'shiftKeyCode': 110, 'code': 'NumpadDecimal', 'key': '\u0000', 'shiftKey': '.', 'location': 3},
    'Digit0': {'keyCode': 48, 'code': 'Digit0', 'shiftKey': ')', 'key': '0'},
    'Digit1': {'keyCode': 49, 'code': 'Digit1', 'shiftKey': '!', 'key': '1'},
    'Digit2': {'keyCode': 50, 'code': 'Digit2', 'shiftKey': '@', 'key': '2'},
    'Digit3': {'keyCode': 51, 'code': 'Digit3', 'shiftKey': '#', 'key': '3'},
    'Digit4': {'keyCode': 52, 'code': 'Digit4', 'shiftKey': '$', 'key': '4'},
    'Digit5': {'keyCode': 53, 'code': 'Digit5', 'shiftKey': '%', 'key': '5'},
    'Digit6': {'keyCode': 54, 'code': 'Digit6', 'shiftKey': '^', 'key': '6'},
    'Digit7': {'keyCode': 55, 'code': 'Digit7', 'shiftKey': '&', 'key': '7'},
    'Digit8': {'keyCode': 56, 'code': 'Digit8', 'shiftKey': '*', 'key': '8'},
    'Digit9': {'keyCode': 57, 'code': 'Digit9', 'shiftKey': '\(', 'key': '9'},
    'KeyA': {'keyCode': 65, 'code': 'KeyA', 'shiftKey': 'A', 'key': 'a'},
    'KeyB': {'keyCode': 66, 'code': 'KeyB', 'shiftKey': 'B', 'key': 'b'},
    'KeyC': {'keyCode': 67, 'code': 'KeyC', 'shiftKey': 'C', 'key': 'c'},
    'KeyD': {'keyCode': 68, 'code': 'KeyD', 'shiftKey': 'D', 'key': 'd'},
    'KeyE': {'keyCode': 69, 'code': 'KeyE', 'shiftKey': 'E', 'key': 'e'},
    'KeyF': {'keyCode': 70, 'code': 'KeyF', 'shiftKey': 'F', 'key': 'f'},
    'KeyG': {'keyCode': 71, 'code': 'KeyG', 'shiftKey': 'G', 'key': 'g'},
    'KeyH': {'keyCode': 72, 'code': 'KeyH', 'shiftKey': 'H', 'key': 'h'},
    'KeyI': {'keyCode': 73, 'code': 'KeyI', 'shiftKey': 'I', 'key': 'i'},
    'KeyJ': {'keyCode': 74, 'code': 'KeyJ', 'shiftKey': 'J', 'key': 'j'},
    'KeyK': {'keyCode': 75, 'code': 'KeyK', 'shiftKey': 'K', 'key': 'k'},
    'KeyL': {'keyCode': 76, 'code': 'KeyL', 'shiftKey': 'L', 'key': 'l'},
    'KeyM': {'keyCode': 77, 'code': 'KeyM', 'shiftKey': 'M', 'key': 'm'},
    'KeyN': {'keyCode': 78, 'code': 'KeyN', 'shiftKey': 'N', 'key': 'n'},
    'KeyO': {'keyCode': 79, 'code': 'KeyO', 'shiftKey': 'O', 'key': 'o'},
    'KeyP': {'keyCode': 80, 'code': 'KeyP', 'shiftKey': 'P', 'key': 'p'},
    'KeyQ': {'keyCode': 81, 'code': 'KeyQ', 'shiftKey': 'Q', 'key': 'q'},
    'KeyR': {'keyCode': 82, 'code': 'KeyR', 'shiftKey': 'R', 'key': 'r'},
    'KeyS': {'keyCode': 83, 'code': 'KeyS', 'shiftKey': 'S', 'key': 's'},
    'KeyT': {'keyCode': 84, 'code': 'KeyT', 'shiftKey': 'T', 'key': 't'},
    'KeyU': {'keyCode': 85, 'code': 'KeyU', 'shiftKey': 'U', 'key': 'u'},
    'KeyV': {'keyCode': 86, 'code': 'KeyV', 'shiftKey': 'V', 'key': 'v'},
    'KeyW': {'keyCode': 87, 'code': 'KeyW', 'shiftKey': 'W', 'key': 'w'},
    'KeyX': {'keyCode': 88, 'code': 'KeyX', 'shiftKey': 'X', 'key': 'x'},
    'KeyY': {'keyCode': 89, 'code': 'KeyY', 'shiftKey': 'Y', 'key': 'y'},
    'KeyZ': {'keyCode': 90, 'code': 'KeyZ', 'shiftKey': 'Z', 'key': 'z'},
    'MetaLeft': {'keyCode': 91, 'code': 'MetaLeft', 'key': 'Meta', 'location': 1},
    'MetaRight': {'keyCode': 92, 'code': 'MetaRight', 'key': 'Meta', 'location': 2},
    'ContextMenu': {'keyCode': 93, 'code': 'ContextMenu', 'key': 'ContextMenu'},
    'NumpadMultiply': {'keyCode': 106, 'code': 'NumpadMultiply', 'key': '*', 'location': 3},
    'NumpadAdd': {'keyCode': 107, 'code': 'NumpadAdd', 'key': '+', 'location': 3},
    'NumpadSubtract': {'keyCode': 109, 'code': 'NumpadSubtract', 'key': '-', 'location': 3},
    'NumpadDivide': {'keyCode': 111, 'code': 'NumpadDivide', 'key': '/', 'location': 3},
    'F1': {'keyCode': 112, 'code': 'F1', 'key': 'F1'},
    'F2': {'keyCode': 113, 'code': 'F2', 'key': 'F2'},
    'F3': {'keyCode': 114, 'code': 'F3', 'key': 'F3'},
    'F4': {'keyCode': 115, 'code': 'F4', 'key': 'F4'},
    'F5': {'keyCode': 116, 'code': 'F5', 'key': 'F5'},
    'F6': {'keyCode': 117, 'code': 'F6', 'key': 'F6'},
    'F7': {'keyCode': 118, 'code': 'F7', 'key': 'F7'},
    'F8': {'keyCode': 119, 'code': 'F8', 'key': 'F8'},
    'F9': {'keyCode': 120, 'code': 'F9', 'key': 'F9'},
    'F10': {'keyCode': 121, 'code': 'F10', 'key': 'F10'},
    'F11': {'keyCode': 122, 'code': 'F11', 'key': 'F11'},
    'F12': {'keyCode': 123, 'code': 'F12', 'key': 'F12'},
    'F13': {'keyCode': 124, 'code': 'F13', 'key': 'F13'},
    'F14': {'keyCode': 125, 'code': 'F14', 'key': 'F14'},
    'F15': {'keyCode': 126, 'code': 'F15', 'key': 'F15'},
    'F16': {'keyCode': 127, 'code': 'F16', 'key': 'F16'},
    'F17': {'keyCode': 128, 'code': 'F17', 'key': 'F17'},
    'F18': {'keyCode': 129, 'code': 'F18', 'key': 'F18'},
    'F19': {'keyCode': 130, 'code': 'F19', 'key': 'F19'},
    'F20': {'keyCode': 131, 'code': 'F20', 'key': 'F20'},
    'F21': {'keyCode': 132, 'code': 'F21', 'key': 'F21'},
    'F22': {'keyCode': 133, 'code': 'F22', 'key': 'F22'},
    'F23': {'keyCode': 134, 'code': 'F23', 'key': 'F23'},
    'F24': {'keyCode': 135, 'code': 'F24', 'key': 'F24'},
    'NumLock': {'keyCode': 144, 'code': 'NumLock', 'key': 'NumLock'},
    'ScrollLock': {'keyCode': 145, 'code': 'ScrollLock', 'key': 'ScrollLock'},
    'AudioVolumeMute': {'keyCode': 173, 'code': 'AudioVolumeMute', 'key': 'AudioVolumeMute'},
    'AudioVolumeDown': {'keyCode': 174, 'code': 'AudioVolumeDown', 'key': 'AudioVolumeDown'},
    'AudioVolumeUp': {'keyCode': 175, 'code': 'AudioVolumeUp', 'key': 'AudioVolumeUp'},
    'MediaTrackNext': {'keyCode': 176, 'code': 'MediaTrackNext', 'key': 'MediaTrackNext'},
    'MediaTrackPrevious': {'keyCode': 177, 'code': 'MediaTrackPrevious', 'key': 'MediaTrackPrevious'},
    'MediaStop': {'keyCode': 178, 'code': 'MediaStop', 'key': 'MediaStop'},
    'MediaPlayPause': {'keyCode': 179, 'code': 'MediaPlayPause', 'key': 'MediaPlayPause'},
    'Semicolon': {'keyCode': 186, 'code': 'Semicolon', 'shiftKey': ':', 'key': ';'},
    'Equal': {'keyCode': 187, 'code': 'Equal', 'shiftKey': '+', 'key': '='},
    'NumpadEqual': {'keyCode': 187, 'code': 'NumpadEqual', 'key': '=', 'location': 3},
    'Comma': {'keyCode': 188, 'code': 'Comma', 'shiftKey': '\<', 'key': ','},
    'Minus': {'keyCode': 189, 'code': 'Minus', 'shiftKey': '_', 'key': '-'},
    'Period': {'keyCode': 190, 'code': 'Period', 'shiftKey': '>', 'key': '.'},
    'Slash': {'keyCode': 191, 'code': 'Slash', 'shiftKey': '?', 'key': '/'},
    'Backquote': {'keyCode': 192, 'code': 'Backquote', 'shiftKey': '~', 'key': '`'},
    'BracketLeft': {'keyCode': 219, 'code': 'BracketLeft', 'shiftKey': '{', 'key': '['},
    'Backslash': {'keyCode': 220, 'code': 'Backslash', 'shiftKey': '|', 'key': '\\'},
    'BracketRight': {'keyCode': 221, 'code': 'BracketRight', 'shiftKey': '}', 'key': ']'},
    'Quote': {'keyCode': 222, 'code': 'Quote', 'shiftKey': '"', 'key': '\''},
    'AltGraph': {'keyCode': 225, 'code': 'AltGraph', 'key': 'AltGraph'},
    'Props': {'keyCode': 247, 'code': 'Props', 'key': 'CrSel'},
    'Cancel': {'keyCode': 3, 'key': 'Cancel', 'code': 'Abort'},
    'Clear': {'keyCode': 12, 'key': 'Clear', 'code': 'Numpad5', 'location': 3},
    'Shift': {'keyCode': 16, 'key': 'Shift', 'code': 'ShiftLeft', 'location': 1},
    'Control': {'keyCode': 17, 'key': 'Control', 'code': 'ControlLeft', 'location': 1},
    'Alt': {'keyCode': 18, 'key': 'Alt', 'code': 'AltLeft', 'location': 1},
    'Accept': {'keyCode': 30, 'key': 'Accept'},
    'ModeChange': {'keyCode': 31, 'key': 'ModeChange'},
    ' ': {'keyCode': 32, 'key': ' ', 'code': 'Space'},
    'Print': {'keyCode': 42, 'key': 'Print'},
    'Execute': {'keyCode': 43, 'key': 'Execute', 'code': 'Open'},
    '\u0000': {'keyCode': 46, 'key': '\u0000', 'code': 'NumpadDecimal', 'location': 3},
    'a': {'keyCode': 65, 'key': 'a', 'code': 'KeyA'},
    'b': {'keyCode': 66, 'key': 'b', 'code': 'KeyB'},
    'c': {'keyCode': 67, 'key': 'c', 'code': 'KeyC'},
    'd': {'keyCode': 68, 'key': 'd', 'code': 'KeyD'},
    'e': {'keyCode': 69, 'key': 'e', 'code': 'KeyE'},
    'f': {'keyCode': 70, 'key': 'f', 'code': 'KeyF'},
    'g': {'keyCode': 71, 'key': 'g', 'code': 'KeyG'},
    'h': {'keyCode': 72, 'key': 'h', 'code': 'KeyH'},
    'i': {'keyCode': 73, 'key': 'i', 'code': 'KeyI'},
    'j': {'keyCode': 74, 'key': 'j', 'code': 'KeyJ'},
    'k': {'keyCode': 75, 'key': 'k', 'code': 'KeyK'},
    'l': {'keyCode': 76, 'key': 'l', 'code': 'KeyL'},
    'm': {'keyCode': 77, 'key': 'm', 'code': 'KeyM'},
    'n': {'keyCode': 78, 'key': 'n', 'code': 'KeyN'},
    'o': {'keyCode': 79, 'key': 'o', 'code': 'KeyO'},
    'p': {'keyCode': 80, 'key': 'p', 'code': 'KeyP'},
    'q': {'keyCode': 81, 'key': 'q', 'code': 'KeyQ'},
    'r': {'keyCode': 82, 'key': 'r', 'code': 'KeyR'},
    's': {'keyCode': 83, 'key': 's', 'code': 'KeyS'},
    't': {'keyCode': 84, 'key': 't', 'code': 'KeyT'},
    'u': {'keyCode': 85, 'key': 'u', 'code': 'KeyU'},
    'v': {'keyCode': 86, 'key': 'v', 'code': 'KeyV'},
    'w': {'keyCode': 87, 'key': 'w', 'code': 'KeyW'},
    'x': {'keyCode': 88, 'key': 'x', 'code': 'KeyX'},
    'y': {'keyCode': 89, 'key': 'y', 'code': 'KeyY'},
    'z': {'keyCode': 90, 'key': 'z', 'code': 'KeyZ'},
    'Meta': {'keyCode': 91, 'key': 'Meta', 'code': 'MetaLeft', 'location': 1},
    '*': {'keyCode': 106, 'key': '*', 'code': 'NumpadMultiply', 'location': 3},
    '+': {'keyCode': 107, 'key': '+', 'code': 'NumpadAdd', 'location': 3},
    '-': {'keyCode': 109, 'key': '-', 'code': 'NumpadSubtract', 'location': 3},
    '/': {'keyCode': 111, 'key': '/', 'code': 'NumpadDivide', 'location': 3},
    ';': {'keyCode': 186, 'key': ';', 'code': 'Semicolon'},
    '=': {'keyCode': 187, 'key': '=', 'code': 'Equal'},
    ',': {'keyCode': 188, 'key': ',', 'code': 'Comma'},
    '.': {'keyCode': 190, 'key': '.', 'code': 'Period'},
    '`': {'keyCode': 192, 'key': '`', 'code': 'Backquote'},
    '[': {'keyCode': 219, 'key': '[', 'code': 'BracketLeft'},
    '\\': {'keyCode': 220, 'key': '\\', 'code': 'Backslash'},
    ']': {'keyCode': 221, 'key': ']', 'code': 'BracketRight'},
    '\'': {'keyCode': 222, 'key': '\'', 'code': 'Quote'},
    'Attn': {'keyCode': 246, 'key': 'Attn'},
    'CrSel': {'keyCode': 247, 'key': 'CrSel', 'code': 'Props'},
    'ExSel': {'keyCode': 248, 'key': 'ExSel'},
    'EraseEof': {'keyCode': 249, 'key': 'EraseEof'},
    'Play': {'keyCode': 250, 'key': 'Play'},
    'ZoomOut': {'keyCode': 251, 'key': 'ZoomOut'},
    ')': {'keyCode': 48, 'key': ')', 'code': 'Digit0'},
    '!': {'keyCode': 49, 'key': '!', 'code': 'Digit1'},
    '@': {'keyCode': 50, 'key': '@', 'code': 'Digit2'},
    '#': {'keyCode': 51, 'key': '#', 'code': 'Digit3'},
    '$': {'keyCode': 52, 'key': '$', 'code': 'Digit4'},
    '%': {'keyCode': 53, 'key': '%', 'code': 'Digit5'},
    '^': {'keyCode': 54, 'key': '^', 'code': 'Digit6'},
    '&': {'keyCode': 55, 'key': '&', 'code': 'Digit7'},
    '(': {'keyCode': 57, 'key': '\(', 'code': 'Digit9'},
    'A': {'keyCode': 65, 'key': 'A', 'code': 'KeyA'},
    'B': {'keyCode': 66, 'key': 'B', 'code': 'KeyB'},
    'C': {'keyCode': 67, 'key': 'C', 'code': 'KeyC'},
    'D': {'keyCode': 68, 'key': 'D', 'code': 'KeyD'},
    'E': {'keyCode': 69, 'key': 'E', 'code': 'KeyE'},
    'F': {'keyCode': 70, 'key': 'F', 'code': 'KeyF'},
    'G': {'keyCode': 71, 'key': 'G', 'code': 'KeyG'},
    'H': {'keyCode': 72, 'key': 'H', 'code': 'KeyH'},
    'I': {'keyCode': 73, 'key': 'I', 'code': 'KeyI'},
    'J': {'keyCode': 74, 'key': 'J', 'code': 'KeyJ'},
    'K': {'keyCode': 75, 'key': 'K', 'code': 'KeyK'},
    'L': {'keyCode': 76, 'key': 'L', 'code': 'KeyL'},
    'M': {'keyCode': 77, 'key': 'M', 'code': 'KeyM'},
    'N': {'keyCode': 78, 'key': 'N', 'code': 'KeyN'},
    'O': {'keyCode': 79, 'key': 'O', 'code': 'KeyO'},
    'P': {'keyCode': 80, 'key': 'P', 'code': 'KeyP'},
    'Q': {'keyCode': 81, 'key': 'Q', 'code': 'KeyQ'},
    'R': {'keyCode': 82, 'key': 'R', 'code': 'KeyR'},
    'S': {'keyCode': 83, 'key': 'S', 'code': 'KeyS'},
    'T': {'keyCode': 84, 'key': 'T', 'code': 'KeyT'},
    'U': {'keyCode': 85, 'key': 'U', 'code': 'KeyU'},
    'V': {'keyCode': 86, 'key': 'V', 'code': 'KeyV'},
    'W': {'keyCode': 87, 'key': 'W', 'code': 'KeyW'},
    'X': {'keyCode': 88, 'key': 'X', 'code': 'KeyX'},
    'Y': {'keyCode': 89, 'key': 'Y', 'code': 'KeyY'},
    'Z': {'keyCode': 90, 'key': 'Z', 'code': 'KeyZ'},
    ':': {'keyCode': 186, 'key': ':', 'code': 'Semicolon'},
    '<': {'keyCode': 188, 'key': '\<', 'code': 'Comma'},
    '_': {'keyCode': 189, 'key': '_', 'code': 'Minus'},
    '>': {'keyCode': 190, 'key': '>', 'code': 'Period'},
    '?': {'keyCode': 191, 'key': '?', 'code': 'Slash'},
    '~': {'keyCode': 192, 'key': '~', 'code': 'Backquote'},
    '{': {'keyCode': 219, 'key': '{', 'code': 'BracketLeft'},
    '|': {'keyCode': 220, 'key': '|', 'code': 'Backslash'},
    '}': {'keyCode': 221, 'key': '}', 'code': 'BracketRight'},
    '"': {'keyCode': 222, 'key': '"', 'code': 'Quote'},
    'SoftLeft': {'key': 'SoftLeft', 'code': 'SoftLeft', 'location': 4},
    'SoftRight': {'key': 'SoftRight', 'code': 'SoftRight', 'location': 4},
    'Camera': {'keyCode': 44, 'key': 'Camera', 'code': 'Camera', 'location': 4},
    'Call': {'key': 'Call', 'code': 'Call', 'location': 4},
    'EndCall': {'keyCode': 95, 'key': 'EndCall', 'code': 'EndCall', 'location': 4},
    'VolumeDown': {'keyCode': 182, 'key': 'VolumeDown', 'code': 'VolumeDown', 'location': 4},
    'VolumeUp': {'keyCode': 183, 'key': 'VolumeUp', 'code': 'VolumeUp', 'location': 4},
  };
  },{}],66:[function(require,module,exports){
  /**
   * Copyright 2018 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  const WebSocket = require('ws');
  
  /**
   * @implements {!Puppeteer.ConnectionTransport}
   */
  class WebSocketTransport {
    /**
     * @param {string} url
     * @return {!Promise<!WebSocketTransport>}
     */
    static create(url) {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(url, [], {
          perMessageDeflate: false,
          maxPayload: 256 * 1024 * 1024, // 256Mb
        });
        ws.addEventListener('open', () => resolve(new WebSocketTransport(ws)));
        ws.addEventListener('error', reject);
      });
    }
  
    /**
     * @param {!WebSocket} ws
     */
    constructor(ws) {
      this._ws = ws;
      this._ws.addEventListener('message', event => {
        if (this.onmessage)
          this.onmessage.call(null, event.data);
      });
      this._ws.addEventListener('close', event => {
        if (this.onclose)
          this.onclose.call(null);
      });
      // Silently ignore all errors - we don't know what to do with them.
      this._ws.addEventListener('error', () => {});
      this.onmessage = null;
      this.onclose = null;
    }
  
    /**
     * @param {string} message
     */
    send(message) {
      this._ws.send(message);
    }
  
    close() {
      this._ws.close();
    }
  }
  
  module.exports = WebSocketTransport;
  
  },{"ws":81}],67:[function(require,module,exports){
  /**
   * Copyright 2018 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  const EventEmitter = require('events');
  const {debugError} = require('./helper');
  const {ExecutionContext} = require('./ExecutionContext');
  const {JSHandle} = require('./JSHandle');
  
  class Worker extends EventEmitter {
    /**
     * @param {Puppeteer.CDPSession} client
     * @param {string} url
     * @param {function(string, !Array<!JSHandle>, Protocol.Runtime.StackTrace=):void} consoleAPICalled
     * @param {function(!Protocol.Runtime.ExceptionDetails):void} exceptionThrown
     */
    constructor(client, url, consoleAPICalled, exceptionThrown) {
      super();
      this._client = client;
      this._url = url;
      this._executionContextPromise = new Promise(x => this._executionContextCallback = x);
      /** @type {function(!Protocol.Runtime.RemoteObject):!JSHandle} */
      let jsHandleFactory;
      this._client.once('Runtime.executionContextCreated', async event => {
        jsHandleFactory = remoteObject => new JSHandle(executionContext, client, remoteObject);
        const executionContext = new ExecutionContext(client, event.context, null);
        this._executionContextCallback(executionContext);
      });
      // This might fail if the target is closed before we recieve all execution contexts.
      this._client.send('Runtime.enable', {}).catch(debugError);
  
      this._client.on('Runtime.consoleAPICalled', event => consoleAPICalled(event.type, event.args.map(jsHandleFactory), event.stackTrace));
      this._client.on('Runtime.exceptionThrown', exception => exceptionThrown(exception.exceptionDetails));
    }
  
    /**
     * @return {string}
     */
    url() {
      return this._url;
    }
  
    /**
     * @return {!Promise<ExecutionContext>}
     */
    async executionContext() {
      return this._executionContextPromise;
    }
  
    /**
     * @param {Function|string} pageFunction
     * @param {!Array<*>} args
     * @return {!Promise<*>}
     */
    async evaluate(pageFunction, ...args) {
      return (await this._executionContextPromise).evaluate(pageFunction, ...args);
    }
  
    /**
     * @param {Function|string} pageFunction
     * @param {!Array<*>} args
     * @return {!Promise<!JSHandle>}
     */
    async evaluateHandle(pageFunction, ...args) {
      return (await this._executionContextPromise).evaluateHandle(pageFunction, ...args);
    }
  }
  
  module.exports = {Worker};
  
  },{"./ExecutionContext":51,"./JSHandle":54,"./helper":69,"events":5}],68:[function(require,module,exports){
  /**
   * Copyright 2019 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  
  module.exports = {
    Accessibility: require('./Accessibility').Accessibility,
    Browser: require('./Browser').Browser,
    BrowserContext: require('./Browser').BrowserContext,
    BrowserFetcher: require('./BrowserFetcher'),
    CDPSession: require('./Connection').CDPSession,
    ConsoleMessage: require('./Page').ConsoleMessage,
    Coverage: require('./Coverage').Coverage,
    Dialog: require('./Dialog').Dialog,
    ElementHandle: require('./JSHandle').ElementHandle,
    ExecutionContext: require('./ExecutionContext').ExecutionContext,
    FileChooser: require('./Page').FileChooser,
    Frame: require('./FrameManager').Frame,
    JSHandle: require('./JSHandle').JSHandle,
    Keyboard: require('./Input').Keyboard,
    Mouse: require('./Input').Mouse,
    Page: require('./Page').Page,
    Puppeteer: require('./Puppeteer'),
    Request: require('./NetworkManager').Request,
    Response: require('./NetworkManager').Response,
    SecurityDetails: require('./NetworkManager').SecurityDetails,
    Target: require('./Target').Target,
    TimeoutError: require('./Errors').TimeoutError,
    Touchscreen: require('./Input').Touchscreen,
    Tracing: require('./Tracing'),
    Worker: require('./Worker').Worker,
  };
  
  },{"./Accessibility":41,"./Browser":42,"./BrowserFetcher":2,"./Connection":43,"./Coverage":44,"./Dialog":47,"./Errors":49,"./ExecutionContext":51,"./FrameManager":52,"./Input":53,"./JSHandle":54,"./NetworkManager":57,"./Page":58,"./Puppeteer":60,"./Target":61,"./Tracing":64,"./Worker":67}],69:[function(require,module,exports){
  (function (Buffer){(function (){
  /**
   * Copyright 2017 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  const {TimeoutError} = require('./Errors');
  const debugError = require('debug')(`puppeteer:error`);
  const fs = require('fs');
  
  class Helper {
    /**
     * @param {Function|string} fun
     * @param {!Array<*>} args
     * @return {string}
     */
    static evaluationString(fun, ...args) {
      if (Helper.isString(fun)) {
        assert(args.length === 0, 'Cannot evaluate a string with arguments');
        return /** @type {string} */ (fun);
      }
      return `(${fun})(${args.map(serializeArgument).join(',')})`;
  
      /**
       * @param {*} arg
       * @return {string}
       */
      function serializeArgument(arg) {
        if (Object.is(arg, undefined))
          return 'undefined';
        return JSON.stringify(arg);
      }
    }
  
    /**
     * @param {!Protocol.Runtime.ExceptionDetails} exceptionDetails
     * @return {string}
     */
    static getExceptionMessage(exceptionDetails) {
      if (exceptionDetails.exception)
        return exceptionDetails.exception.description || exceptionDetails.exception.value;
      let message = exceptionDetails.text;
      if (exceptionDetails.stackTrace) {
        for (const callframe of exceptionDetails.stackTrace.callFrames) {
          const location = callframe.url + ':' + callframe.lineNumber + ':' + callframe.columnNumber;
          const functionName = callframe.functionName || '<anonymous>';
          message += `\n    at ${functionName} (${location})`;
        }
      }
      return message;
    }
  
    /**
     * @param {!Protocol.Runtime.RemoteObject} remoteObject
     * @return {*}
     */
    static valueFromRemoteObject(remoteObject) {
      assert(!remoteObject.objectId, 'Cannot extract value when objectId is given');
      if (remoteObject.unserializableValue) {
        if (remoteObject.type === 'bigint' && typeof BigInt !== 'undefined')
          return BigInt(remoteObject.unserializableValue.replace('n', ''));
        switch (remoteObject.unserializableValue) {
          case '-0':
            return -0;
          case 'NaN':
            return NaN;
          case 'Infinity':
            return Infinity;
          case '-Infinity':
            return -Infinity;
          default:
            throw new Error('Unsupported unserializable value: ' + remoteObject.unserializableValue);
        }
      }
      return remoteObject.value;
    }
  
    /**
     * @param {!Puppeteer.CDPSession} client
     * @param {!Protocol.Runtime.RemoteObject} remoteObject
     */
    static async releaseObject(client, remoteObject) {
      if (!remoteObject.objectId)
        return;
      await client.send('Runtime.releaseObject', {objectId: remoteObject.objectId}).catch(error => {
        // Exceptions might happen in case of a page been navigated or closed.
        // Swallow these since they are harmless and we don't leak anything in this case.
        debugError(error);
      });
    }
  
    /**
     * @param {!Object} classType
     */
    static installAsyncStackHooks(classType) {
      for (const methodName of Reflect.ownKeys(classType.prototype)) {
        const method = Reflect.get(classType.prototype, methodName);
        if (methodName === 'constructor' || typeof methodName !== 'string' || methodName.startsWith('_') || typeof method !== 'function' || method.constructor.name !== 'AsyncFunction')
          continue;
        Reflect.set(classType.prototype, methodName, function(...args) {
          const syncStack = {};
          Error.captureStackTrace(syncStack);
          return method.call(this, ...args).catch(e => {
            const stack = syncStack.stack.substring(syncStack.stack.indexOf('\n') + 1);
            const clientStack = stack.substring(stack.indexOf('\n'));
            if (e instanceof Error && e.stack && !e.stack.includes(clientStack))
              e.stack += '\n  -- ASYNC --\n' + stack;
            throw e;
          });
        });
      }
    }
  
    /**
     * @param {!NodeJS.EventEmitter} emitter
     * @param {(string|symbol)} eventName
     * @param {function(?):void} handler
     * @return {{emitter: !NodeJS.EventEmitter, eventName: (string|symbol), handler: function(?)}}
     */
    static addEventListener(emitter, eventName, handler) {
      emitter.on(eventName, handler);
      return { emitter, eventName, handler };
    }
  
    /**
     * @param {!Array<{emitter: !NodeJS.EventEmitter, eventName: (string|symbol), handler: function(?):void}>} listeners
     */
    static removeEventListeners(listeners) {
      for (const listener of listeners)
        listener.emitter.removeListener(listener.eventName, listener.handler);
      listeners.length = 0;
    }
  
    /**
     * @param {!Object} obj
     * @return {boolean}
     */
    static isString(obj) {
      return typeof obj === 'string' || obj instanceof String;
    }
  
    /**
     * @param {!Object} obj
     * @return {boolean}
     */
    static isNumber(obj) {
      return typeof obj === 'number' || obj instanceof Number;
    }
  
    /**
     * @param {function} nodeFunction
     * @return {function}
     */
    static promisify(nodeFunction) {
      function promisified(...args) {
        return new Promise((resolve, reject) => {
          function callback(err, ...result) {
            if (err)
              return reject(err);
            if (result.length === 1)
              return resolve(result[0]);
            return resolve(result);
          }
          nodeFunction.call(null, ...args, callback);
        });
      }
      return promisified;
    }
  
    /**
     * @param {!NodeJS.EventEmitter} emitter
     * @param {(string|symbol)} eventName
     * @param {function} predicate
     * @param {number} timeout
     * @param {!Promise<!Error>} abortPromise
     * @return {!Promise}
     */
    static async waitForEvent(emitter, eventName, predicate, timeout, abortPromise) {
      let eventTimeout, resolveCallback, rejectCallback;
      const promise = new Promise((resolve, reject) => {
        resolveCallback = resolve;
        rejectCallback = reject;
      });
      const listener = Helper.addEventListener(emitter, eventName, event => {
        if (!predicate(event))
          return;
        resolveCallback(event);
      });
      if (timeout) {
        eventTimeout = setTimeout(() => {
          rejectCallback(new TimeoutError('Timeout exceeded while waiting for event'));
        }, timeout);
      }
      function cleanup() {
        Helper.removeEventListeners([listener]);
        clearTimeout(eventTimeout);
      }
      const result = await Promise.race([promise, abortPromise]).then(r => {
        cleanup();
        return r;
      }, e => {
        cleanup();
        throw e;
      });
      if (result instanceof Error)
        throw result;
      return result;
    }
  
    /**
     * @template T
     * @param {!Promise<T>} promise
     * @param {string} taskName
     * @param {number} timeout
     * @return {!Promise<T>}
     */
    static async waitWithTimeout(promise, taskName, timeout) {
      let reject;
      const timeoutError = new TimeoutError(`waiting for ${taskName} failed: timeout ${timeout}ms exceeded`);
      const timeoutPromise = new Promise((resolve, x) => reject = x);
      let timeoutTimer = null;
      if (timeout)
        timeoutTimer = setTimeout(() => reject(timeoutError), timeout);
      try {
        return await Promise.race([promise, timeoutPromise]);
      } finally {
        if (timeoutTimer)
          clearTimeout(timeoutTimer);
      }
    }
  
    /**
     * @param {!Puppeteer.CDPSession} client
     * @param {string} handle
     * @param {?string} path
     * @return {!Promise<!Buffer>}
     */
    static async readProtocolStream(client, handle, path) {
      let eof = false;
      let file;
      if (path)
        file = await openAsync(path, 'w');
      const bufs = [];
      while (!eof) {
        const response = await client.send('IO.read', {handle});
        eof = response.eof;
        const buf = Buffer.from(response.data, response.base64Encoded ? 'base64' : undefined);
        bufs.push(buf);
        if (path)
          await writeAsync(file, buf);
      }
      if (path)
        await closeAsync(file);
      await client.send('IO.close', {handle});
      let resultBuffer = null;
      try {
        resultBuffer = Buffer.concat(bufs);
      } finally {
        return resultBuffer;
      }
    }
  }
  
  const openAsync = Helper.promisify(fs.open);
  const writeAsync = Helper.promisify(fs.write);
  const closeAsync = Helper.promisify(fs.close);
  
  /**
   * @param {*} value
   * @param {string=} message
   */
  function assert(value, message) {
    if (!value)
      throw new Error(message);
  }
  
  module.exports = {
    helper: Helper,
    assert,
    debugError
  };
  
  }).call(this)}).call(this,require("buffer").Buffer)
  },{"./Errors":49,"buffer":3,"debug":70,"fs":2}],70:[function(require,module,exports){
  (function (process){(function (){
  /* eslint-env browser */
  
  /**
   * This is the web browser implementation of `debug()`.
   */
  
  exports.formatArgs = formatArgs;
  exports.save = save;
  exports.load = load;
  exports.useColors = useColors;
  exports.storage = localstorage();
  exports.destroy = (() => {
    let warned = false;
  
    return () => {
      if (!warned) {
        warned = true;
        console.warn('Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.');
      }
    };
  })();
  
  /**
   * Colors.
   */
  
  exports.colors = [
    '#0000CC',
    '#0000FF',
    '#0033CC',
    '#0033FF',
    '#0066CC',
    '#0066FF',
    '#0099CC',
    '#0099FF',
    '#00CC00',
    '#00CC33',
    '#00CC66',
    '#00CC99',
    '#00CCCC',
    '#00CCFF',
    '#3300CC',
    '#3300FF',
    '#3333CC',
    '#3333FF',
    '#3366CC',
    '#3366FF',
    '#3399CC',
    '#3399FF',
    '#33CC00',
    '#33CC33',
    '#33CC66',
    '#33CC99',
    '#33CCCC',
    '#33CCFF',
    '#6600CC',
    '#6600FF',
    '#6633CC',
    '#6633FF',
    '#66CC00',
    '#66CC33',
    '#9900CC',
    '#9900FF',
    '#9933CC',
    '#9933FF',
    '#99CC00',
    '#99CC33',
    '#CC0000',
    '#CC0033',
    '#CC0066',
    '#CC0099',
    '#CC00CC',
    '#CC00FF',
    '#CC3300',
    '#CC3333',
    '#CC3366',
    '#CC3399',
    '#CC33CC',
    '#CC33FF',
    '#CC6600',
    '#CC6633',
    '#CC9900',
    '#CC9933',
    '#CCCC00',
    '#CCCC33',
    '#FF0000',
    '#FF0033',
    '#FF0066',
    '#FF0099',
    '#FF00CC',
    '#FF00FF',
    '#FF3300',
    '#FF3333',
    '#FF3366',
    '#FF3399',
    '#FF33CC',
    '#FF33FF',
    '#FF6600',
    '#FF6633',
    '#FF9900',
    '#FF9933',
    '#FFCC00',
    '#FFCC33'
  ];
  
  /**
   * Currently only WebKit-based Web Inspectors, Firefox >= v31,
   * and the Firebug extension (any Firefox version) are known
   * to support "%c" CSS customizations.
   *
   * TODO: add a `localStorage` variable to explicitly enable/disable colors
   */
  
  // eslint-disable-next-line complexity
  function useColors() {
    // NB: In an Electron preload script, document will be defined but not fully
    // initialized. Since we know we're in Chrome, we'll just detect this case
    // explicitly
    if (typeof window !== 'undefined' && window.process && (window.process.type === 'renderer' || window.process.__nwjs)) {
      return true;
    }
  
    // Internet Explorer and Edge do not support colors.
    if (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
      return false;
    }
  
    // Is webkit? http://stackoverflow.com/a/16459606/376773
    // document is undefined in react-native: https://github.com/facebook/react-native/pull/1632
    return (typeof document !== 'undefined' && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance) ||
      // Is firebug? http://stackoverflow.com/a/398120/376773
      (typeof window !== 'undefined' && window.console && (window.console.firebug || (window.console.exception && window.console.table))) ||
      // Is firefox >= v31?
      // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
      (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31) ||
      // Double check webkit in userAgent just in case we are in a worker
      (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/));
  }
  
  /**
   * Colorize log arguments if enabled.
   *
   * @api public
   */
  
  function formatArgs(args) {
    args[0] = (this.useColors ? '%c' : '') +
      this.namespace +
      (this.useColors ? ' %c' : ' ') +
      args[0] +
      (this.useColors ? '%c ' : ' ') +
      '+' + module.exports.humanize(this.diff);
  
    if (!this.useColors) {
      return;
    }
  
    const c = 'color: ' + this.color;
    args.splice(1, 0, c, 'color: inherit');
  
    // The final "%c" is somewhat tricky, because there could be other
    // arguments passed either before or after the %c, so we need to
    // figure out the correct index to insert the CSS into
    let index = 0;
    let lastC = 0;
    args[0].replace(/%[a-zA-Z%]/g, match => {
      if (match === '%%') {
        return;
      }
      index++;
      if (match === '%c') {
        // We only are interested in the *last* %c
        // (the user may have provided their own)
        lastC = index;
      }
    });
  
    args.splice(lastC, 0, c);
  }
  
  /**
   * Invokes `console.debug()` when available.
   * No-op when `console.debug` is not a "function".
   * If `console.debug` is not available, falls back
   * to `console.log`.
   *
   * @api public
   */
  exports.log = console.debug || console.log || (() => {});
  
  /**
   * Save `namespaces`.
   *
   * @param {String} namespaces
   * @api private
   */
  function save(namespaces) {
    try {
      if (namespaces) {
        exports.storage.setItem('debug', namespaces);
      } else {
        exports.storage.removeItem('debug');
      }
    } catch (error) {
      // Swallow
      // XXX (@Qix-) should we be logging these?
    }
  }
  
  /**
   * Load `namespaces`.
   *
   * @return {String} returns the previously persisted debug modes
   * @api private
   */
  function load() {
    let r;
    try {
      r = exports.storage.getItem('debug');
    } catch (error) {
      // Swallow
      // XXX (@Qix-) should we be logging these?
    }
  
    // If debug isn't set in LS, and we're in Electron, try to load $DEBUG
    if (!r && typeof process !== 'undefined' && 'env' in process) {
      r = process.env.DEBUG;
    }
  
    return r;
  }
  
  /**
   * Localstorage attempts to return the localstorage.
   *
   * This is necessary because safari throws
   * when a user disables cookies/localstorage
   * and you attempt to access it.
   *
   * @return {LocalStorage}
   * @api private
   */
  
  function localstorage() {
    try {
      // TVMLKit (Apple TV JS Runtime) does not have a window object, just localStorage in the global context
      // The Browser also has localStorage in the global context.
      return localStorage;
    } catch (error) {
      // Swallow
      // XXX (@Qix-) should we be logging these?
    }
  }
  
  module.exports = require('./common')(exports);
  
  const {formatters} = module.exports;
  
  /**
   * Map %j to `JSON.stringify()`, since no Web Inspectors do that by default.
   */
  
  formatters.j = function (v) {
    try {
      return JSON.stringify(v);
    } catch (error) {
      return '[UnexpectedJSONParseError]: ' + error.message;
    }
  };
  
  }).call(this)}).call(this,require('_process'))
  },{"./common":71,"_process":11}],71:[function(require,module,exports){
  
  /**
   * This is the common logic for both the Node.js and web browser
   * implementations of `debug()`.
   */
  
  function setup(env) {
    createDebug.debug = createDebug;
    createDebug.default = createDebug;
    createDebug.coerce = coerce;
    createDebug.disable = disable;
    createDebug.enable = enable;
    createDebug.enabled = enabled;
    createDebug.humanize = require('ms');
    createDebug.destroy = destroy;
  
    Object.keys(env).forEach(key => {
      createDebug[key] = env[key];
    });
  
    /**
    * The currently active debug mode names, and names to skip.
    */
  
    createDebug.names = [];
    createDebug.skips = [];
  
    /**
    * Map of special "%n" handling functions, for the debug "format" argument.
    *
    * Valid key names are a single, lower or upper-case letter, i.e. "n" and "N".
    */
    createDebug.formatters = {};
  
    /**
    * Selects a color for a debug namespace
    * @param {String} namespace The namespace string for the for the debug instance to be colored
    * @return {Number|String} An ANSI color code for the given namespace
    * @api private
    */
    function selectColor(namespace) {
      let hash = 0;
  
      for (let i = 0; i < namespace.length; i++) {
        hash = ((hash << 5) - hash) + namespace.charCodeAt(i);
        hash |= 0; // Convert to 32bit integer
      }
  
      return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
    }
    createDebug.selectColor = selectColor;
  
    /**
    * Create a debugger with the given `namespace`.
    *
    * @param {String} namespace
    * @return {Function}
    * @api public
    */
    function createDebug(namespace) {
      let prevTime;
      let enableOverride = null;
  
      function debug(...args) {
        // Disabled?
        if (!debug.enabled) {
          return;
        }
  
        const self = debug;
  
        // Set `diff` timestamp
        const curr = Number(new Date());
        const ms = curr - (prevTime || curr);
        self.diff = ms;
        self.prev = prevTime;
        self.curr = curr;
        prevTime = curr;
  
        args[0] = createDebug.coerce(args[0]);
  
        if (typeof args[0] !== 'string') {
          // Anything else let's inspect with %O
          args.unshift('%O');
        }
  
        // Apply any `formatters` transformations
        let index = 0;
        args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
          // If we encounter an escaped % then don't increase the array index
          if (match === '%%') {
            return '%';
          }
          index++;
          const formatter = createDebug.formatters[format];
          if (typeof formatter === 'function') {
            const val = args[index];
            match = formatter.call(self, val);
  
            // Now we need to remove `args[index]` since it's inlined in the `format`
            args.splice(index, 1);
            index--;
          }
          return match;
        });
  
        // Apply env-specific formatting (colors, etc.)
        createDebug.formatArgs.call(self, args);
  
        const logFn = self.log || createDebug.log;
        logFn.apply(self, args);
      }
  
      debug.namespace = namespace;
      debug.useColors = createDebug.useColors();
      debug.color = createDebug.selectColor(namespace);
      debug.extend = extend;
      debug.destroy = createDebug.destroy; // XXX Temporary. Will be removed in the next major release.
  
      Object.defineProperty(debug, 'enabled', {
        enumerable: true,
        configurable: false,
        get: () => enableOverride === null ? createDebug.enabled(namespace) : enableOverride,
        set: v => {
          enableOverride = v;
        }
      });
  
      // Env-specific initialization logic for debug instances
      if (typeof createDebug.init === 'function') {
        createDebug.init(debug);
      }
  
      return debug;
    }
  
    function extend(namespace, delimiter) {
      const newDebug = createDebug(this.namespace + (typeof delimiter === 'undefined' ? ':' : delimiter) + namespace);
      newDebug.log = this.log;
      return newDebug;
    }
  
    /**
    * Enables a debug mode by namespaces. This can include modes
    * separated by a colon and wildcards.
    *
    * @param {String} namespaces
    * @api public
    */
    function enable(namespaces) {
      createDebug.save(namespaces);
  
      createDebug.names = [];
      createDebug.skips = [];
  
      let i;
      const split = (typeof namespaces === 'string' ? namespaces : '').split(/[\s,]+/);
      const len = split.length;
  
      for (i = 0; i < len; i++) {
        if (!split[i]) {
          // ignore empty strings
          continue;
        }
  
        namespaces = split[i].replace(/\*/g, '.*?');
  
        if (namespaces[0] === '-') {
          createDebug.skips.push(new RegExp('^' + namespaces.substr(1) + '$'));
        } else {
          createDebug.names.push(new RegExp('^' + namespaces + '$'));
        }
      }
    }
  
    /**
    * Disable debug output.
    *
    * @return {String} namespaces
    * @api public
    */
    function disable() {
      const namespaces = [
        ...createDebug.names.map(toNamespace),
        ...createDebug.skips.map(toNamespace).map(namespace => '-' + namespace)
      ].join(',');
      createDebug.enable('');
      return namespaces;
    }
  
    /**
    * Returns true if the given mode name is enabled, false otherwise.
    *
    * @param {String} name
    * @return {Boolean}
    * @api public
    */
    function enabled(name) {
      if (name[name.length - 1] === '*') {
        return true;
      }
  
      let i;
      let len;
  
      for (i = 0, len = createDebug.skips.length; i < len; i++) {
        if (createDebug.skips[i].test(name)) {
          return false;
        }
      }
  
      for (i = 0, len = createDebug.names.length; i < len; i++) {
        if (createDebug.names[i].test(name)) {
          return true;
        }
      }
  
      return false;
    }
  
    /**
    * Convert regexp to namespace
    *
    * @param {RegExp} regxep
    * @return {String} namespace
    * @api private
    */
    function toNamespace(regexp) {
      return regexp.toString()
        .substring(2, regexp.toString().length - 2)
        .replace(/\.\*\?$/, '*');
    }
  
    /**
    * Coerce `val`.
    *
    * @param {Mixed} val
    * @return {Mixed}
    * @api private
    */
    function coerce(val) {
      if (val instanceof Error) {
        return val.stack || val.message;
      }
      return val;
    }
  
    /**
    * XXX DO NOT USE. This is a temporary stub function.
    * XXX It WILL be removed in the next major release.
    */
    function destroy() {
      console.warn('Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.');
    }
  
    createDebug.enable(createDebug.load());
  
    return createDebug;
  }
  
  module.exports = setup;
  
  },{"ms":79}],72:[function(require,module,exports){
  module.exports={
    "application/1d-interleaved-parityfec": {
      "source": "iana"
    },
    "application/3gpdash-qoe-report+xml": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true
    },
    "application/3gpp-ims+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/a2l": {
      "source": "iana"
    },
    "application/activemessage": {
      "source": "iana"
    },
    "application/activity+json": {
      "source": "iana",
      "compressible": true
    },
    "application/alto-costmap+json": {
      "source": "iana",
      "compressible": true
    },
    "application/alto-costmapfilter+json": {
      "source": "iana",
      "compressible": true
    },
    "application/alto-directory+json": {
      "source": "iana",
      "compressible": true
    },
    "application/alto-endpointcost+json": {
      "source": "iana",
      "compressible": true
    },
    "application/alto-endpointcostparams+json": {
      "source": "iana",
      "compressible": true
    },
    "application/alto-endpointprop+json": {
      "source": "iana",
      "compressible": true
    },
    "application/alto-endpointpropparams+json": {
      "source": "iana",
      "compressible": true
    },
    "application/alto-error+json": {
      "source": "iana",
      "compressible": true
    },
    "application/alto-networkmap+json": {
      "source": "iana",
      "compressible": true
    },
    "application/alto-networkmapfilter+json": {
      "source": "iana",
      "compressible": true
    },
    "application/alto-updatestreamcontrol+json": {
      "source": "iana",
      "compressible": true
    },
    "application/alto-updatestreamparams+json": {
      "source": "iana",
      "compressible": true
    },
    "application/aml": {
      "source": "iana"
    },
    "application/andrew-inset": {
      "source": "iana",
      "extensions": ["ez"]
    },
    "application/applefile": {
      "source": "iana"
    },
    "application/applixware": {
      "source": "apache",
      "extensions": ["aw"]
    },
    "application/atf": {
      "source": "iana"
    },
    "application/atfx": {
      "source": "iana"
    },
    "application/atom+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["atom"]
    },
    "application/atomcat+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["atomcat"]
    },
    "application/atomdeleted+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["atomdeleted"]
    },
    "application/atomicmail": {
      "source": "iana"
    },
    "application/atomsvc+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["atomsvc"]
    },
    "application/atsc-dwd+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["dwd"]
    },
    "application/atsc-dynamic-event-message": {
      "source": "iana"
    },
    "application/atsc-held+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["held"]
    },
    "application/atsc-rdt+json": {
      "source": "iana",
      "compressible": true
    },
    "application/atsc-rsat+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["rsat"]
    },
    "application/atxml": {
      "source": "iana"
    },
    "application/auth-policy+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/bacnet-xdd+zip": {
      "source": "iana",
      "compressible": false
    },
    "application/batch-smtp": {
      "source": "iana"
    },
    "application/bdoc": {
      "compressible": false,
      "extensions": ["bdoc"]
    },
    "application/beep+xml": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true
    },
    "application/calendar+json": {
      "source": "iana",
      "compressible": true
    },
    "application/calendar+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["xcs"]
    },
    "application/call-completion": {
      "source": "iana"
    },
    "application/cals-1840": {
      "source": "iana"
    },
    "application/captive+json": {
      "source": "iana",
      "compressible": true
    },
    "application/cbor": {
      "source": "iana"
    },
    "application/cbor-seq": {
      "source": "iana"
    },
    "application/cccex": {
      "source": "iana"
    },
    "application/ccmp+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/ccxml+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["ccxml"]
    },
    "application/cdfx+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["cdfx"]
    },
    "application/cdmi-capability": {
      "source": "iana",
      "extensions": ["cdmia"]
    },
    "application/cdmi-container": {
      "source": "iana",
      "extensions": ["cdmic"]
    },
    "application/cdmi-domain": {
      "source": "iana",
      "extensions": ["cdmid"]
    },
    "application/cdmi-object": {
      "source": "iana",
      "extensions": ["cdmio"]
    },
    "application/cdmi-queue": {
      "source": "iana",
      "extensions": ["cdmiq"]
    },
    "application/cdni": {
      "source": "iana"
    },
    "application/cea": {
      "source": "iana"
    },
    "application/cea-2018+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/cellml+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/cfw": {
      "source": "iana"
    },
    "application/clue+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/clue_info+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/cms": {
      "source": "iana"
    },
    "application/cnrp+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/coap-group+json": {
      "source": "iana",
      "compressible": true
    },
    "application/coap-payload": {
      "source": "iana"
    },
    "application/commonground": {
      "source": "iana"
    },
    "application/conference-info+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/cose": {
      "source": "iana"
    },
    "application/cose-key": {
      "source": "iana"
    },
    "application/cose-key-set": {
      "source": "iana"
    },
    "application/cpl+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/csrattrs": {
      "source": "iana"
    },
    "application/csta+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/cstadata+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/csvm+json": {
      "source": "iana",
      "compressible": true
    },
    "application/cu-seeme": {
      "source": "apache",
      "extensions": ["cu"]
    },
    "application/cwt": {
      "source": "iana"
    },
    "application/cybercash": {
      "source": "iana"
    },
    "application/dart": {
      "compressible": true
    },
    "application/dash+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["mpd"]
    },
    "application/dashdelta": {
      "source": "iana"
    },
    "application/davmount+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["davmount"]
    },
    "application/dca-rft": {
      "source": "iana"
    },
    "application/dcd": {
      "source": "iana"
    },
    "application/dec-dx": {
      "source": "iana"
    },
    "application/dialog-info+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/dicom": {
      "source": "iana"
    },
    "application/dicom+json": {
      "source": "iana",
      "compressible": true
    },
    "application/dicom+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/dii": {
      "source": "iana"
    },
    "application/dit": {
      "source": "iana"
    },
    "application/dns": {
      "source": "iana"
    },
    "application/dns+json": {
      "source": "iana",
      "compressible": true
    },
    "application/dns-message": {
      "source": "iana"
    },
    "application/docbook+xml": {
      "source": "apache",
      "compressible": true,
      "extensions": ["dbk"]
    },
    "application/dots+cbor": {
      "source": "iana"
    },
    "application/dskpp+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/dssc+der": {
      "source": "iana",
      "extensions": ["dssc"]
    },
    "application/dssc+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["xdssc"]
    },
    "application/dvcs": {
      "source": "iana"
    },
    "application/ecmascript": {
      "source": "iana",
      "compressible": true,
      "extensions": ["ecma","es"]
    },
    "application/edi-consent": {
      "source": "iana"
    },
    "application/edi-x12": {
      "source": "iana",
      "compressible": false
    },
    "application/edifact": {
      "source": "iana",
      "compressible": false
    },
    "application/efi": {
      "source": "iana"
    },
    "application/emergencycalldata.cap+xml": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true
    },
    "application/emergencycalldata.comment+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/emergencycalldata.control+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/emergencycalldata.deviceinfo+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/emergencycalldata.ecall.msd": {
      "source": "iana"
    },
    "application/emergencycalldata.providerinfo+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/emergencycalldata.serviceinfo+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/emergencycalldata.subscriberinfo+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/emergencycalldata.veds+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/emma+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["emma"]
    },
    "application/emotionml+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["emotionml"]
    },
    "application/encaprtp": {
      "source": "iana"
    },
    "application/epp+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/epub+zip": {
      "source": "iana",
      "compressible": false,
      "extensions": ["epub"]
    },
    "application/eshop": {
      "source": "iana"
    },
    "application/exi": {
      "source": "iana",
      "extensions": ["exi"]
    },
    "application/expect-ct-report+json": {
      "source": "iana",
      "compressible": true
    },
    "application/fastinfoset": {
      "source": "iana"
    },
    "application/fastsoap": {
      "source": "iana"
    },
    "application/fdt+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["fdt"]
    },
    "application/fhir+json": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true
    },
    "application/fhir+xml": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true
    },
    "application/fido.trusted-apps+json": {
      "compressible": true
    },
    "application/fits": {
      "source": "iana"
    },
    "application/flexfec": {
      "source": "iana"
    },
    "application/font-sfnt": {
      "source": "iana"
    },
    "application/font-tdpfr": {
      "source": "iana",
      "extensions": ["pfr"]
    },
    "application/font-woff": {
      "source": "iana",
      "compressible": false
    },
    "application/framework-attributes+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/geo+json": {
      "source": "iana",
      "compressible": true,
      "extensions": ["geojson"]
    },
    "application/geo+json-seq": {
      "source": "iana"
    },
    "application/geopackage+sqlite3": {
      "source": "iana"
    },
    "application/geoxacml+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/gltf-buffer": {
      "source": "iana"
    },
    "application/gml+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["gml"]
    },
    "application/gpx+xml": {
      "source": "apache",
      "compressible": true,
      "extensions": ["gpx"]
    },
    "application/gxf": {
      "source": "apache",
      "extensions": ["gxf"]
    },
    "application/gzip": {
      "source": "iana",
      "compressible": false,
      "extensions": ["gz"]
    },
    "application/h224": {
      "source": "iana"
    },
    "application/held+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/hjson": {
      "extensions": ["hjson"]
    },
    "application/http": {
      "source": "iana"
    },
    "application/hyperstudio": {
      "source": "iana",
      "extensions": ["stk"]
    },
    "application/ibe-key-request+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/ibe-pkg-reply+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/ibe-pp-data": {
      "source": "iana"
    },
    "application/iges": {
      "source": "iana"
    },
    "application/im-iscomposing+xml": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true
    },
    "application/index": {
      "source": "iana"
    },
    "application/index.cmd": {
      "source": "iana"
    },
    "application/index.obj": {
      "source": "iana"
    },
    "application/index.response": {
      "source": "iana"
    },
    "application/index.vnd": {
      "source": "iana"
    },
    "application/inkml+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["ink","inkml"]
    },
    "application/iotp": {
      "source": "iana"
    },
    "application/ipfix": {
      "source": "iana",
      "extensions": ["ipfix"]
    },
    "application/ipp": {
      "source": "iana"
    },
    "application/isup": {
      "source": "iana"
    },
    "application/its+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["its"]
    },
    "application/java-archive": {
      "source": "apache",
      "compressible": false,
      "extensions": ["jar","war","ear"]
    },
    "application/java-serialized-object": {
      "source": "apache",
      "compressible": false,
      "extensions": ["ser"]
    },
    "application/java-vm": {
      "source": "apache",
      "compressible": false,
      "extensions": ["class"]
    },
    "application/javascript": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true,
      "extensions": ["js","mjs"]
    },
    "application/jf2feed+json": {
      "source": "iana",
      "compressible": true
    },
    "application/jose": {
      "source": "iana"
    },
    "application/jose+json": {
      "source": "iana",
      "compressible": true
    },
    "application/jrd+json": {
      "source": "iana",
      "compressible": true
    },
    "application/json": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true,
      "extensions": ["json","map"]
    },
    "application/json-patch+json": {
      "source": "iana",
      "compressible": true
    },
    "application/json-seq": {
      "source": "iana"
    },
    "application/json5": {
      "extensions": ["json5"]
    },
    "application/jsonml+json": {
      "source": "apache",
      "compressible": true,
      "extensions": ["jsonml"]
    },
    "application/jwk+json": {
      "source": "iana",
      "compressible": true
    },
    "application/jwk-set+json": {
      "source": "iana",
      "compressible": true
    },
    "application/jwt": {
      "source": "iana"
    },
    "application/kpml-request+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/kpml-response+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/ld+json": {
      "source": "iana",
      "compressible": true,
      "extensions": ["jsonld"]
    },
    "application/lgr+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["lgr"]
    },
    "application/link-format": {
      "source": "iana"
    },
    "application/load-control+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/lost+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["lostxml"]
    },
    "application/lostsync+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/lpf+zip": {
      "source": "iana",
      "compressible": false
    },
    "application/lxf": {
      "source": "iana"
    },
    "application/mac-binhex40": {
      "source": "iana",
      "extensions": ["hqx"]
    },
    "application/mac-compactpro": {
      "source": "apache",
      "extensions": ["cpt"]
    },
    "application/macwriteii": {
      "source": "iana"
    },
    "application/mads+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["mads"]
    },
    "application/manifest+json": {
      "charset": "UTF-8",
      "compressible": true,
      "extensions": ["webmanifest"]
    },
    "application/marc": {
      "source": "iana",
      "extensions": ["mrc"]
    },
    "application/marcxml+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["mrcx"]
    },
    "application/mathematica": {
      "source": "iana",
      "extensions": ["ma","nb","mb"]
    },
    "application/mathml+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["mathml"]
    },
    "application/mathml-content+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/mathml-presentation+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/mbms-associated-procedure-description+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/mbms-deregister+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/mbms-envelope+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/mbms-msk+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/mbms-msk-response+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/mbms-protection-description+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/mbms-reception-report+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/mbms-register+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/mbms-register-response+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/mbms-schedule+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/mbms-user-service-description+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/mbox": {
      "source": "iana",
      "extensions": ["mbox"]
    },
    "application/media-policy-dataset+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/media_control+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/mediaservercontrol+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["mscml"]
    },
    "application/merge-patch+json": {
      "source": "iana",
      "compressible": true
    },
    "application/metalink+xml": {
      "source": "apache",
      "compressible": true,
      "extensions": ["metalink"]
    },
    "application/metalink4+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["meta4"]
    },
    "application/mets+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["mets"]
    },
    "application/mf4": {
      "source": "iana"
    },
    "application/mikey": {
      "source": "iana"
    },
    "application/mipc": {
      "source": "iana"
    },
    "application/mmt-aei+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["maei"]
    },
    "application/mmt-usd+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["musd"]
    },
    "application/mods+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["mods"]
    },
    "application/moss-keys": {
      "source": "iana"
    },
    "application/moss-signature": {
      "source": "iana"
    },
    "application/mosskey-data": {
      "source": "iana"
    },
    "application/mosskey-request": {
      "source": "iana"
    },
    "application/mp21": {
      "source": "iana",
      "extensions": ["m21","mp21"]
    },
    "application/mp4": {
      "source": "iana",
      "extensions": ["mp4s","m4p"]
    },
    "application/mpeg4-generic": {
      "source": "iana"
    },
    "application/mpeg4-iod": {
      "source": "iana"
    },
    "application/mpeg4-iod-xmt": {
      "source": "iana"
    },
    "application/mrb-consumer+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["xdf"]
    },
    "application/mrb-publish+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["xdf"]
    },
    "application/msc-ivr+xml": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true
    },
    "application/msc-mixer+xml": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true
    },
    "application/msword": {
      "source": "iana",
      "compressible": false,
      "extensions": ["doc","dot"]
    },
    "application/mud+json": {
      "source": "iana",
      "compressible": true
    },
    "application/multipart-core": {
      "source": "iana"
    },
    "application/mxf": {
      "source": "iana",
      "extensions": ["mxf"]
    },
    "application/n-quads": {
      "source": "iana",
      "extensions": ["nq"]
    },
    "application/n-triples": {
      "source": "iana",
      "extensions": ["nt"]
    },
    "application/nasdata": {
      "source": "iana"
    },
    "application/news-checkgroups": {
      "source": "iana",
      "charset": "US-ASCII"
    },
    "application/news-groupinfo": {
      "source": "iana",
      "charset": "US-ASCII"
    },
    "application/news-transmission": {
      "source": "iana"
    },
    "application/nlsml+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/node": {
      "source": "iana",
      "extensions": ["cjs"]
    },
    "application/nss": {
      "source": "iana"
    },
    "application/ocsp-request": {
      "source": "iana"
    },
    "application/ocsp-response": {
      "source": "iana"
    },
    "application/octet-stream": {
      "source": "iana",
      "compressible": false,
      "extensions": ["bin","dms","lrf","mar","so","dist","distz","pkg","bpk","dump","elc","deploy","exe","dll","deb","dmg","iso","img","msi","msp","msm","buffer"]
    },
    "application/oda": {
      "source": "iana",
      "extensions": ["oda"]
    },
    "application/odm+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/odx": {
      "source": "iana"
    },
    "application/oebps-package+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["opf"]
    },
    "application/ogg": {
      "source": "iana",
      "compressible": false,
      "extensions": ["ogx"]
    },
    "application/omdoc+xml": {
      "source": "apache",
      "compressible": true,
      "extensions": ["omdoc"]
    },
    "application/onenote": {
      "source": "apache",
      "extensions": ["onetoc","onetoc2","onetmp","onepkg"]
    },
    "application/opc-nodeset+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/oscore": {
      "source": "iana"
    },
    "application/oxps": {
      "source": "iana",
      "extensions": ["oxps"]
    },
    "application/p2p-overlay+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["relo"]
    },
    "application/parityfec": {
      "source": "iana"
    },
    "application/passport": {
      "source": "iana"
    },
    "application/patch-ops-error+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["xer"]
    },
    "application/pdf": {
      "source": "iana",
      "compressible": false,
      "extensions": ["pdf"]
    },
    "application/pdx": {
      "source": "iana"
    },
    "application/pem-certificate-chain": {
      "source": "iana"
    },
    "application/pgp-encrypted": {
      "source": "iana",
      "compressible": false,
      "extensions": ["pgp"]
    },
    "application/pgp-keys": {
      "source": "iana"
    },
    "application/pgp-signature": {
      "source": "iana",
      "extensions": ["asc","sig"]
    },
    "application/pics-rules": {
      "source": "apache",
      "extensions": ["prf"]
    },
    "application/pidf+xml": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true
    },
    "application/pidf-diff+xml": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true
    },
    "application/pkcs10": {
      "source": "iana",
      "extensions": ["p10"]
    },
    "application/pkcs12": {
      "source": "iana"
    },
    "application/pkcs7-mime": {
      "source": "iana",
      "extensions": ["p7m","p7c"]
    },
    "application/pkcs7-signature": {
      "source": "iana",
      "extensions": ["p7s"]
    },
    "application/pkcs8": {
      "source": "iana",
      "extensions": ["p8"]
    },
    "application/pkcs8-encrypted": {
      "source": "iana"
    },
    "application/pkix-attr-cert": {
      "source": "iana",
      "extensions": ["ac"]
    },
    "application/pkix-cert": {
      "source": "iana",
      "extensions": ["cer"]
    },
    "application/pkix-crl": {
      "source": "iana",
      "extensions": ["crl"]
    },
    "application/pkix-pkipath": {
      "source": "iana",
      "extensions": ["pkipath"]
    },
    "application/pkixcmp": {
      "source": "iana",
      "extensions": ["pki"]
    },
    "application/pls+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["pls"]
    },
    "application/poc-settings+xml": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true
    },
    "application/postscript": {
      "source": "iana",
      "compressible": true,
      "extensions": ["ai","eps","ps"]
    },
    "application/ppsp-tracker+json": {
      "source": "iana",
      "compressible": true
    },
    "application/problem+json": {
      "source": "iana",
      "compressible": true
    },
    "application/problem+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/provenance+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["provx"]
    },
    "application/prs.alvestrand.titrax-sheet": {
      "source": "iana"
    },
    "application/prs.cww": {
      "source": "iana",
      "extensions": ["cww"]
    },
    "application/prs.hpub+zip": {
      "source": "iana",
      "compressible": false
    },
    "application/prs.nprend": {
      "source": "iana"
    },
    "application/prs.plucker": {
      "source": "iana"
    },
    "application/prs.rdf-xml-crypt": {
      "source": "iana"
    },
    "application/prs.xsf+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/pskc+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["pskcxml"]
    },
    "application/pvd+json": {
      "source": "iana",
      "compressible": true
    },
    "application/qsig": {
      "source": "iana"
    },
    "application/raml+yaml": {
      "compressible": true,
      "extensions": ["raml"]
    },
    "application/raptorfec": {
      "source": "iana"
    },
    "application/rdap+json": {
      "source": "iana",
      "compressible": true
    },
    "application/rdf+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["rdf","owl"]
    },
    "application/reginfo+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["rif"]
    },
    "application/relax-ng-compact-syntax": {
      "source": "iana",
      "extensions": ["rnc"]
    },
    "application/remote-printing": {
      "source": "iana"
    },
    "application/reputon+json": {
      "source": "iana",
      "compressible": true
    },
    "application/resource-lists+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["rl"]
    },
    "application/resource-lists-diff+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["rld"]
    },
    "application/rfc+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/riscos": {
      "source": "iana"
    },
    "application/rlmi+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/rls-services+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["rs"]
    },
    "application/route-apd+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["rapd"]
    },
    "application/route-s-tsid+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["sls"]
    },
    "application/route-usd+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["rusd"]
    },
    "application/rpki-ghostbusters": {
      "source": "iana",
      "extensions": ["gbr"]
    },
    "application/rpki-manifest": {
      "source": "iana",
      "extensions": ["mft"]
    },
    "application/rpki-publication": {
      "source": "iana"
    },
    "application/rpki-roa": {
      "source": "iana",
      "extensions": ["roa"]
    },
    "application/rpki-updown": {
      "source": "iana"
    },
    "application/rsd+xml": {
      "source": "apache",
      "compressible": true,
      "extensions": ["rsd"]
    },
    "application/rss+xml": {
      "source": "apache",
      "compressible": true,
      "extensions": ["rss"]
    },
    "application/rtf": {
      "source": "iana",
      "compressible": true,
      "extensions": ["rtf"]
    },
    "application/rtploopback": {
      "source": "iana"
    },
    "application/rtx": {
      "source": "iana"
    },
    "application/samlassertion+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/samlmetadata+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/sarif+json": {
      "source": "iana",
      "compressible": true
    },
    "application/sbe": {
      "source": "iana"
    },
    "application/sbml+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["sbml"]
    },
    "application/scaip+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/scim+json": {
      "source": "iana",
      "compressible": true
    },
    "application/scvp-cv-request": {
      "source": "iana",
      "extensions": ["scq"]
    },
    "application/scvp-cv-response": {
      "source": "iana",
      "extensions": ["scs"]
    },
    "application/scvp-vp-request": {
      "source": "iana",
      "extensions": ["spq"]
    },
    "application/scvp-vp-response": {
      "source": "iana",
      "extensions": ["spp"]
    },
    "application/sdp": {
      "source": "iana",
      "extensions": ["sdp"]
    },
    "application/secevent+jwt": {
      "source": "iana"
    },
    "application/senml+cbor": {
      "source": "iana"
    },
    "application/senml+json": {
      "source": "iana",
      "compressible": true
    },
    "application/senml+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["senmlx"]
    },
    "application/senml-etch+cbor": {
      "source": "iana"
    },
    "application/senml-etch+json": {
      "source": "iana",
      "compressible": true
    },
    "application/senml-exi": {
      "source": "iana"
    },
    "application/sensml+cbor": {
      "source": "iana"
    },
    "application/sensml+json": {
      "source": "iana",
      "compressible": true
    },
    "application/sensml+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["sensmlx"]
    },
    "application/sensml-exi": {
      "source": "iana"
    },
    "application/sep+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/sep-exi": {
      "source": "iana"
    },
    "application/session-info": {
      "source": "iana"
    },
    "application/set-payment": {
      "source": "iana"
    },
    "application/set-payment-initiation": {
      "source": "iana",
      "extensions": ["setpay"]
    },
    "application/set-registration": {
      "source": "iana"
    },
    "application/set-registration-initiation": {
      "source": "iana",
      "extensions": ["setreg"]
    },
    "application/sgml": {
      "source": "iana"
    },
    "application/sgml-open-catalog": {
      "source": "iana"
    },
    "application/shf+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["shf"]
    },
    "application/sieve": {
      "source": "iana",
      "extensions": ["siv","sieve"]
    },
    "application/simple-filter+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/simple-message-summary": {
      "source": "iana"
    },
    "application/simplesymbolcontainer": {
      "source": "iana"
    },
    "application/sipc": {
      "source": "iana"
    },
    "application/slate": {
      "source": "iana"
    },
    "application/smil": {
      "source": "iana"
    },
    "application/smil+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["smi","smil"]
    },
    "application/smpte336m": {
      "source": "iana"
    },
    "application/soap+fastinfoset": {
      "source": "iana"
    },
    "application/soap+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/sparql-query": {
      "source": "iana",
      "extensions": ["rq"]
    },
    "application/sparql-results+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["srx"]
    },
    "application/spirits-event+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/sql": {
      "source": "iana"
    },
    "application/srgs": {
      "source": "iana",
      "extensions": ["gram"]
    },
    "application/srgs+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["grxml"]
    },
    "application/sru+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["sru"]
    },
    "application/ssdl+xml": {
      "source": "apache",
      "compressible": true,
      "extensions": ["ssdl"]
    },
    "application/ssml+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["ssml"]
    },
    "application/stix+json": {
      "source": "iana",
      "compressible": true
    },
    "application/swid+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["swidtag"]
    },
    "application/tamp-apex-update": {
      "source": "iana"
    },
    "application/tamp-apex-update-confirm": {
      "source": "iana"
    },
    "application/tamp-community-update": {
      "source": "iana"
    },
    "application/tamp-community-update-confirm": {
      "source": "iana"
    },
    "application/tamp-error": {
      "source": "iana"
    },
    "application/tamp-sequence-adjust": {
      "source": "iana"
    },
    "application/tamp-sequence-adjust-confirm": {
      "source": "iana"
    },
    "application/tamp-status-query": {
      "source": "iana"
    },
    "application/tamp-status-response": {
      "source": "iana"
    },
    "application/tamp-update": {
      "source": "iana"
    },
    "application/tamp-update-confirm": {
      "source": "iana"
    },
    "application/tar": {
      "compressible": true
    },
    "application/taxii+json": {
      "source": "iana",
      "compressible": true
    },
    "application/td+json": {
      "source": "iana",
      "compressible": true
    },
    "application/tei+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["tei","teicorpus"]
    },
    "application/tetra_isi": {
      "source": "iana"
    },
    "application/thraud+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["tfi"]
    },
    "application/timestamp-query": {
      "source": "iana"
    },
    "application/timestamp-reply": {
      "source": "iana"
    },
    "application/timestamped-data": {
      "source": "iana",
      "extensions": ["tsd"]
    },
    "application/tlsrpt+gzip": {
      "source": "iana"
    },
    "application/tlsrpt+json": {
      "source": "iana",
      "compressible": true
    },
    "application/tnauthlist": {
      "source": "iana"
    },
    "application/toml": {
      "compressible": true,
      "extensions": ["toml"]
    },
    "application/trickle-ice-sdpfrag": {
      "source": "iana"
    },
    "application/trig": {
      "source": "iana"
    },
    "application/ttml+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["ttml"]
    },
    "application/tve-trigger": {
      "source": "iana"
    },
    "application/tzif": {
      "source": "iana"
    },
    "application/tzif-leap": {
      "source": "iana"
    },
    "application/ubjson": {
      "compressible": false,
      "extensions": ["ubj"]
    },
    "application/ulpfec": {
      "source": "iana"
    },
    "application/urc-grpsheet+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/urc-ressheet+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["rsheet"]
    },
    "application/urc-targetdesc+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["td"]
    },
    "application/urc-uisocketdesc+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vcard+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vcard+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vemmi": {
      "source": "iana"
    },
    "application/vividence.scriptfile": {
      "source": "apache"
    },
    "application/vnd.1000minds.decision-model+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["1km"]
    },
    "application/vnd.3gpp-prose+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp-prose-pc3ch+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp-v2x-local-service-information": {
      "source": "iana"
    },
    "application/vnd.3gpp.access-transfer-events+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.bsf+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.gmop+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mc-signalling-ear": {
      "source": "iana"
    },
    "application/vnd.3gpp.mcdata-affiliation-command+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcdata-info+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcdata-payload": {
      "source": "iana"
    },
    "application/vnd.3gpp.mcdata-service-config+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcdata-signalling": {
      "source": "iana"
    },
    "application/vnd.3gpp.mcdata-ue-config+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcdata-user-profile+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcptt-affiliation-command+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcptt-floor-request+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcptt-info+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcptt-location-info+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcptt-mbms-usage-info+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcptt-service-config+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcptt-signed+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcptt-ue-config+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcptt-ue-init-config+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcptt-user-profile+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcvideo-affiliation-command+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcvideo-affiliation-info+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcvideo-info+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcvideo-location-info+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcvideo-mbms-usage-info+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcvideo-service-config+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcvideo-transmission-request+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcvideo-ue-config+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mcvideo-user-profile+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.mid-call+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.pic-bw-large": {
      "source": "iana",
      "extensions": ["plb"]
    },
    "application/vnd.3gpp.pic-bw-small": {
      "source": "iana",
      "extensions": ["psb"]
    },
    "application/vnd.3gpp.pic-bw-var": {
      "source": "iana",
      "extensions": ["pvb"]
    },
    "application/vnd.3gpp.sms": {
      "source": "iana"
    },
    "application/vnd.3gpp.sms+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.srvcc-ext+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.srvcc-info+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.state-and-event-info+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp.ussd+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp2.bcmcsinfo+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.3gpp2.sms": {
      "source": "iana"
    },
    "application/vnd.3gpp2.tcap": {
      "source": "iana",
      "extensions": ["tcap"]
    },
    "application/vnd.3lightssoftware.imagescal": {
      "source": "iana"
    },
    "application/vnd.3m.post-it-notes": {
      "source": "iana",
      "extensions": ["pwn"]
    },
    "application/vnd.accpac.simply.aso": {
      "source": "iana",
      "extensions": ["aso"]
    },
    "application/vnd.accpac.simply.imp": {
      "source": "iana",
      "extensions": ["imp"]
    },
    "application/vnd.acucobol": {
      "source": "iana",
      "extensions": ["acu"]
    },
    "application/vnd.acucorp": {
      "source": "iana",
      "extensions": ["atc","acutc"]
    },
    "application/vnd.adobe.air-application-installer-package+zip": {
      "source": "apache",
      "compressible": false,
      "extensions": ["air"]
    },
    "application/vnd.adobe.flash.movie": {
      "source": "iana"
    },
    "application/vnd.adobe.formscentral.fcdt": {
      "source": "iana",
      "extensions": ["fcdt"]
    },
    "application/vnd.adobe.fxp": {
      "source": "iana",
      "extensions": ["fxp","fxpl"]
    },
    "application/vnd.adobe.partial-upload": {
      "source": "iana"
    },
    "application/vnd.adobe.xdp+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["xdp"]
    },
    "application/vnd.adobe.xfdf": {
      "source": "iana",
      "extensions": ["xfdf"]
    },
    "application/vnd.aether.imp": {
      "source": "iana"
    },
    "application/vnd.afpc.afplinedata": {
      "source": "iana"
    },
    "application/vnd.afpc.afplinedata-pagedef": {
      "source": "iana"
    },
    "application/vnd.afpc.foca-charset": {
      "source": "iana"
    },
    "application/vnd.afpc.foca-codedfont": {
      "source": "iana"
    },
    "application/vnd.afpc.foca-codepage": {
      "source": "iana"
    },
    "application/vnd.afpc.modca": {
      "source": "iana"
    },
    "application/vnd.afpc.modca-formdef": {
      "source": "iana"
    },
    "application/vnd.afpc.modca-mediummap": {
      "source": "iana"
    },
    "application/vnd.afpc.modca-objectcontainer": {
      "source": "iana"
    },
    "application/vnd.afpc.modca-overlay": {
      "source": "iana"
    },
    "application/vnd.afpc.modca-pagesegment": {
      "source": "iana"
    },
    "application/vnd.ah-barcode": {
      "source": "iana"
    },
    "application/vnd.ahead.space": {
      "source": "iana",
      "extensions": ["ahead"]
    },
    "application/vnd.airzip.filesecure.azf": {
      "source": "iana",
      "extensions": ["azf"]
    },
    "application/vnd.airzip.filesecure.azs": {
      "source": "iana",
      "extensions": ["azs"]
    },
    "application/vnd.amadeus+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.amazon.ebook": {
      "source": "apache",
      "extensions": ["azw"]
    },
    "application/vnd.amazon.mobi8-ebook": {
      "source": "iana"
    },
    "application/vnd.americandynamics.acc": {
      "source": "iana",
      "extensions": ["acc"]
    },
    "application/vnd.amiga.ami": {
      "source": "iana",
      "extensions": ["ami"]
    },
    "application/vnd.amundsen.maze+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.android.ota": {
      "source": "iana"
    },
    "application/vnd.android.package-archive": {
      "source": "apache",
      "compressible": false,
      "extensions": ["apk"]
    },
    "application/vnd.anki": {
      "source": "iana"
    },
    "application/vnd.anser-web-certificate-issue-initiation": {
      "source": "iana",
      "extensions": ["cii"]
    },
    "application/vnd.anser-web-funds-transfer-initiation": {
      "source": "apache",
      "extensions": ["fti"]
    },
    "application/vnd.antix.game-component": {
      "source": "iana",
      "extensions": ["atx"]
    },
    "application/vnd.apache.thrift.binary": {
      "source": "iana"
    },
    "application/vnd.apache.thrift.compact": {
      "source": "iana"
    },
    "application/vnd.apache.thrift.json": {
      "source": "iana"
    },
    "application/vnd.api+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.aplextor.warrp+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.apothekende.reservation+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.apple.installer+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["mpkg"]
    },
    "application/vnd.apple.keynote": {
      "source": "iana",
      "extensions": ["key"]
    },
    "application/vnd.apple.mpegurl": {
      "source": "iana",
      "extensions": ["m3u8"]
    },
    "application/vnd.apple.numbers": {
      "source": "iana",
      "extensions": ["numbers"]
    },
    "application/vnd.apple.pages": {
      "source": "iana",
      "extensions": ["pages"]
    },
    "application/vnd.apple.pkpass": {
      "compressible": false,
      "extensions": ["pkpass"]
    },
    "application/vnd.arastra.swi": {
      "source": "iana"
    },
    "application/vnd.aristanetworks.swi": {
      "source": "iana",
      "extensions": ["swi"]
    },
    "application/vnd.artisan+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.artsquare": {
      "source": "iana"
    },
    "application/vnd.astraea-software.iota": {
      "source": "iana",
      "extensions": ["iota"]
    },
    "application/vnd.audiograph": {
      "source": "iana",
      "extensions": ["aep"]
    },
    "application/vnd.autopackage": {
      "source": "iana"
    },
    "application/vnd.avalon+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.avistar+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.balsamiq.bmml+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["bmml"]
    },
    "application/vnd.balsamiq.bmpr": {
      "source": "iana"
    },
    "application/vnd.banana-accounting": {
      "source": "iana"
    },
    "application/vnd.bbf.usp.error": {
      "source": "iana"
    },
    "application/vnd.bbf.usp.msg": {
      "source": "iana"
    },
    "application/vnd.bbf.usp.msg+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.bekitzur-stech+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.bint.med-content": {
      "source": "iana"
    },
    "application/vnd.biopax.rdf+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.blink-idb-value-wrapper": {
      "source": "iana"
    },
    "application/vnd.blueice.multipass": {
      "source": "iana",
      "extensions": ["mpm"]
    },
    "application/vnd.bluetooth.ep.oob": {
      "source": "iana"
    },
    "application/vnd.bluetooth.le.oob": {
      "source": "iana"
    },
    "application/vnd.bmi": {
      "source": "iana",
      "extensions": ["bmi"]
    },
    "application/vnd.bpf": {
      "source": "iana"
    },
    "application/vnd.bpf3": {
      "source": "iana"
    },
    "application/vnd.businessobjects": {
      "source": "iana",
      "extensions": ["rep"]
    },
    "application/vnd.byu.uapi+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.cab-jscript": {
      "source": "iana"
    },
    "application/vnd.canon-cpdl": {
      "source": "iana"
    },
    "application/vnd.canon-lips": {
      "source": "iana"
    },
    "application/vnd.capasystems-pg+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.cendio.thinlinc.clientconf": {
      "source": "iana"
    },
    "application/vnd.century-systems.tcp_stream": {
      "source": "iana"
    },
    "application/vnd.chemdraw+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["cdxml"]
    },
    "application/vnd.chess-pgn": {
      "source": "iana"
    },
    "application/vnd.chipnuts.karaoke-mmd": {
      "source": "iana",
      "extensions": ["mmd"]
    },
    "application/vnd.ciedi": {
      "source": "iana"
    },
    "application/vnd.cinderella": {
      "source": "iana",
      "extensions": ["cdy"]
    },
    "application/vnd.cirpack.isdn-ext": {
      "source": "iana"
    },
    "application/vnd.citationstyles.style+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["csl"]
    },
    "application/vnd.claymore": {
      "source": "iana",
      "extensions": ["cla"]
    },
    "application/vnd.cloanto.rp9": {
      "source": "iana",
      "extensions": ["rp9"]
    },
    "application/vnd.clonk.c4group": {
      "source": "iana",
      "extensions": ["c4g","c4d","c4f","c4p","c4u"]
    },
    "application/vnd.cluetrust.cartomobile-config": {
      "source": "iana",
      "extensions": ["c11amc"]
    },
    "application/vnd.cluetrust.cartomobile-config-pkg": {
      "source": "iana",
      "extensions": ["c11amz"]
    },
    "application/vnd.coffeescript": {
      "source": "iana"
    },
    "application/vnd.collabio.xodocuments.document": {
      "source": "iana"
    },
    "application/vnd.collabio.xodocuments.document-template": {
      "source": "iana"
    },
    "application/vnd.collabio.xodocuments.presentation": {
      "source": "iana"
    },
    "application/vnd.collabio.xodocuments.presentation-template": {
      "source": "iana"
    },
    "application/vnd.collabio.xodocuments.spreadsheet": {
      "source": "iana"
    },
    "application/vnd.collabio.xodocuments.spreadsheet-template": {
      "source": "iana"
    },
    "application/vnd.collection+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.collection.doc+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.collection.next+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.comicbook+zip": {
      "source": "iana",
      "compressible": false
    },
    "application/vnd.comicbook-rar": {
      "source": "iana"
    },
    "application/vnd.commerce-battelle": {
      "source": "iana"
    },
    "application/vnd.commonspace": {
      "source": "iana",
      "extensions": ["csp"]
    },
    "application/vnd.contact.cmsg": {
      "source": "iana",
      "extensions": ["cdbcmsg"]
    },
    "application/vnd.coreos.ignition+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.cosmocaller": {
      "source": "iana",
      "extensions": ["cmc"]
    },
    "application/vnd.crick.clicker": {
      "source": "iana",
      "extensions": ["clkx"]
    },
    "application/vnd.crick.clicker.keyboard": {
      "source": "iana",
      "extensions": ["clkk"]
    },
    "application/vnd.crick.clicker.palette": {
      "source": "iana",
      "extensions": ["clkp"]
    },
    "application/vnd.crick.clicker.template": {
      "source": "iana",
      "extensions": ["clkt"]
    },
    "application/vnd.crick.clicker.wordbank": {
      "source": "iana",
      "extensions": ["clkw"]
    },
    "application/vnd.criticaltools.wbs+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["wbs"]
    },
    "application/vnd.cryptii.pipe+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.crypto-shade-file": {
      "source": "iana"
    },
    "application/vnd.ctc-posml": {
      "source": "iana",
      "extensions": ["pml"]
    },
    "application/vnd.ctct.ws+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.cups-pdf": {
      "source": "iana"
    },
    "application/vnd.cups-postscript": {
      "source": "iana"
    },
    "application/vnd.cups-ppd": {
      "source": "iana",
      "extensions": ["ppd"]
    },
    "application/vnd.cups-raster": {
      "source": "iana"
    },
    "application/vnd.cups-raw": {
      "source": "iana"
    },
    "application/vnd.curl": {
      "source": "iana"
    },
    "application/vnd.curl.car": {
      "source": "apache",
      "extensions": ["car"]
    },
    "application/vnd.curl.pcurl": {
      "source": "apache",
      "extensions": ["pcurl"]
    },
    "application/vnd.cyan.dean.root+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.cybank": {
      "source": "iana"
    },
    "application/vnd.d2l.coursepackage1p0+zip": {
      "source": "iana",
      "compressible": false
    },
    "application/vnd.d3m-dataset": {
      "source": "iana"
    },
    "application/vnd.d3m-problem": {
      "source": "iana"
    },
    "application/vnd.dart": {
      "source": "iana",
      "compressible": true,
      "extensions": ["dart"]
    },
    "application/vnd.data-vision.rdz": {
      "source": "iana",
      "extensions": ["rdz"]
    },
    "application/vnd.datapackage+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.dataresource+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.dbf": {
      "source": "iana",
      "extensions": ["dbf"]
    },
    "application/vnd.debian.binary-package": {
      "source": "iana"
    },
    "application/vnd.dece.data": {
      "source": "iana",
      "extensions": ["uvf","uvvf","uvd","uvvd"]
    },
    "application/vnd.dece.ttml+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["uvt","uvvt"]
    },
    "application/vnd.dece.unspecified": {
      "source": "iana",
      "extensions": ["uvx","uvvx"]
    },
    "application/vnd.dece.zip": {
      "source": "iana",
      "extensions": ["uvz","uvvz"]
    },
    "application/vnd.denovo.fcselayout-link": {
      "source": "iana",
      "extensions": ["fe_launch"]
    },
    "application/vnd.desmume.movie": {
      "source": "iana"
    },
    "application/vnd.dir-bi.plate-dl-nosuffix": {
      "source": "iana"
    },
    "application/vnd.dm.delegation+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.dna": {
      "source": "iana",
      "extensions": ["dna"]
    },
    "application/vnd.document+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.dolby.mlp": {
      "source": "apache",
      "extensions": ["mlp"]
    },
    "application/vnd.dolby.mobile.1": {
      "source": "iana"
    },
    "application/vnd.dolby.mobile.2": {
      "source": "iana"
    },
    "application/vnd.doremir.scorecloud-binary-document": {
      "source": "iana"
    },
    "application/vnd.dpgraph": {
      "source": "iana",
      "extensions": ["dpg"]
    },
    "application/vnd.dreamfactory": {
      "source": "iana",
      "extensions": ["dfac"]
    },
    "application/vnd.drive+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.ds-keypoint": {
      "source": "apache",
      "extensions": ["kpxx"]
    },
    "application/vnd.dtg.local": {
      "source": "iana"
    },
    "application/vnd.dtg.local.flash": {
      "source": "iana"
    },
    "application/vnd.dtg.local.html": {
      "source": "iana"
    },
    "application/vnd.dvb.ait": {
      "source": "iana",
      "extensions": ["ait"]
    },
    "application/vnd.dvb.dvbisl+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.dvb.dvbj": {
      "source": "iana"
    },
    "application/vnd.dvb.esgcontainer": {
      "source": "iana"
    },
    "application/vnd.dvb.ipdcdftnotifaccess": {
      "source": "iana"
    },
    "application/vnd.dvb.ipdcesgaccess": {
      "source": "iana"
    },
    "application/vnd.dvb.ipdcesgaccess2": {
      "source": "iana"
    },
    "application/vnd.dvb.ipdcesgpdd": {
      "source": "iana"
    },
    "application/vnd.dvb.ipdcroaming": {
      "source": "iana"
    },
    "application/vnd.dvb.iptv.alfec-base": {
      "source": "iana"
    },
    "application/vnd.dvb.iptv.alfec-enhancement": {
      "source": "iana"
    },
    "application/vnd.dvb.notif-aggregate-root+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.dvb.notif-container+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.dvb.notif-generic+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.dvb.notif-ia-msglist+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.dvb.notif-ia-registration-request+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.dvb.notif-ia-registration-response+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.dvb.notif-init+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.dvb.pfr": {
      "source": "iana"
    },
    "application/vnd.dvb.service": {
      "source": "iana",
      "extensions": ["svc"]
    },
    "application/vnd.dxr": {
      "source": "iana"
    },
    "application/vnd.dynageo": {
      "source": "iana",
      "extensions": ["geo"]
    },
    "application/vnd.dzr": {
      "source": "iana"
    },
    "application/vnd.easykaraoke.cdgdownload": {
      "source": "iana"
    },
    "application/vnd.ecdis-update": {
      "source": "iana"
    },
    "application/vnd.ecip.rlp": {
      "source": "iana"
    },
    "application/vnd.ecowin.chart": {
      "source": "iana",
      "extensions": ["mag"]
    },
    "application/vnd.ecowin.filerequest": {
      "source": "iana"
    },
    "application/vnd.ecowin.fileupdate": {
      "source": "iana"
    },
    "application/vnd.ecowin.series": {
      "source": "iana"
    },
    "application/vnd.ecowin.seriesrequest": {
      "source": "iana"
    },
    "application/vnd.ecowin.seriesupdate": {
      "source": "iana"
    },
    "application/vnd.efi.img": {
      "source": "iana"
    },
    "application/vnd.efi.iso": {
      "source": "iana"
    },
    "application/vnd.emclient.accessrequest+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.enliven": {
      "source": "iana",
      "extensions": ["nml"]
    },
    "application/vnd.enphase.envoy": {
      "source": "iana"
    },
    "application/vnd.eprints.data+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.epson.esf": {
      "source": "iana",
      "extensions": ["esf"]
    },
    "application/vnd.epson.msf": {
      "source": "iana",
      "extensions": ["msf"]
    },
    "application/vnd.epson.quickanime": {
      "source": "iana",
      "extensions": ["qam"]
    },
    "application/vnd.epson.salt": {
      "source": "iana",
      "extensions": ["slt"]
    },
    "application/vnd.epson.ssf": {
      "source": "iana",
      "extensions": ["ssf"]
    },
    "application/vnd.ericsson.quickcall": {
      "source": "iana"
    },
    "application/vnd.espass-espass+zip": {
      "source": "iana",
      "compressible": false
    },
    "application/vnd.eszigno3+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["es3","et3"]
    },
    "application/vnd.etsi.aoc+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.etsi.asic-e+zip": {
      "source": "iana",
      "compressible": false
    },
    "application/vnd.etsi.asic-s+zip": {
      "source": "iana",
      "compressible": false
    },
    "application/vnd.etsi.cug+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.etsi.iptvcommand+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.etsi.iptvdiscovery+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.etsi.iptvprofile+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.etsi.iptvsad-bc+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.etsi.iptvsad-cod+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.etsi.iptvsad-npvr+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.etsi.iptvservice+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.etsi.iptvsync+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.etsi.iptvueprofile+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.etsi.mcid+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.etsi.mheg5": {
      "source": "iana"
    },
    "application/vnd.etsi.overload-control-policy-dataset+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.etsi.pstn+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.etsi.sci+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.etsi.simservs+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.etsi.timestamp-token": {
      "source": "iana"
    },
    "application/vnd.etsi.tsl+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.etsi.tsl.der": {
      "source": "iana"
    },
    "application/vnd.eudora.data": {
      "source": "iana"
    },
    "application/vnd.evolv.ecig.profile": {
      "source": "iana"
    },
    "application/vnd.evolv.ecig.settings": {
      "source": "iana"
    },
    "application/vnd.evolv.ecig.theme": {
      "source": "iana"
    },
    "application/vnd.exstream-empower+zip": {
      "source": "iana",
      "compressible": false
    },
    "application/vnd.exstream-package": {
      "source": "iana"
    },
    "application/vnd.ezpix-album": {
      "source": "iana",
      "extensions": ["ez2"]
    },
    "application/vnd.ezpix-package": {
      "source": "iana",
      "extensions": ["ez3"]
    },
    "application/vnd.f-secure.mobile": {
      "source": "iana"
    },
    "application/vnd.fastcopy-disk-image": {
      "source": "iana"
    },
    "application/vnd.fdf": {
      "source": "iana",
      "extensions": ["fdf"]
    },
    "application/vnd.fdsn.mseed": {
      "source": "iana",
      "extensions": ["mseed"]
    },
    "application/vnd.fdsn.seed": {
      "source": "iana",
      "extensions": ["seed","dataless"]
    },
    "application/vnd.ffsns": {
      "source": "iana"
    },
    "application/vnd.ficlab.flb+zip": {
      "source": "iana",
      "compressible": false
    },
    "application/vnd.filmit.zfc": {
      "source": "iana"
    },
    "application/vnd.fints": {
      "source": "iana"
    },
    "application/vnd.firemonkeys.cloudcell": {
      "source": "iana"
    },
    "application/vnd.flographit": {
      "source": "iana",
      "extensions": ["gph"]
    },
    "application/vnd.fluxtime.clip": {
      "source": "iana",
      "extensions": ["ftc"]
    },
    "application/vnd.font-fontforge-sfd": {
      "source": "iana"
    },
    "application/vnd.framemaker": {
      "source": "iana",
      "extensions": ["fm","frame","maker","book"]
    },
    "application/vnd.frogans.fnc": {
      "source": "iana",
      "extensions": ["fnc"]
    },
    "application/vnd.frogans.ltf": {
      "source": "iana",
      "extensions": ["ltf"]
    },
    "application/vnd.fsc.weblaunch": {
      "source": "iana",
      "extensions": ["fsc"]
    },
    "application/vnd.fujitsu.oasys": {
      "source": "iana",
      "extensions": ["oas"]
    },
    "application/vnd.fujitsu.oasys2": {
      "source": "iana",
      "extensions": ["oa2"]
    },
    "application/vnd.fujitsu.oasys3": {
      "source": "iana",
      "extensions": ["oa3"]
    },
    "application/vnd.fujitsu.oasysgp": {
      "source": "iana",
      "extensions": ["fg5"]
    },
    "application/vnd.fujitsu.oasysprs": {
      "source": "iana",
      "extensions": ["bh2"]
    },
    "application/vnd.fujixerox.art-ex": {
      "source": "iana"
    },
    "application/vnd.fujixerox.art4": {
      "source": "iana"
    },
    "application/vnd.fujixerox.ddd": {
      "source": "iana",
      "extensions": ["ddd"]
    },
    "application/vnd.fujixerox.docuworks": {
      "source": "iana",
      "extensions": ["xdw"]
    },
    "application/vnd.fujixerox.docuworks.binder": {
      "source": "iana",
      "extensions": ["xbd"]
    },
    "application/vnd.fujixerox.docuworks.container": {
      "source": "iana"
    },
    "application/vnd.fujixerox.hbpl": {
      "source": "iana"
    },
    "application/vnd.fut-misnet": {
      "source": "iana"
    },
    "application/vnd.futoin+cbor": {
      "source": "iana"
    },
    "application/vnd.futoin+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.fuzzysheet": {
      "source": "iana",
      "extensions": ["fzs"]
    },
    "application/vnd.genomatix.tuxedo": {
      "source": "iana",
      "extensions": ["txd"]
    },
    "application/vnd.gentics.grd+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.geo+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.geocube+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.geogebra.file": {
      "source": "iana",
      "extensions": ["ggb"]
    },
    "application/vnd.geogebra.tool": {
      "source": "iana",
      "extensions": ["ggt"]
    },
    "application/vnd.geometry-explorer": {
      "source": "iana",
      "extensions": ["gex","gre"]
    },
    "application/vnd.geonext": {
      "source": "iana",
      "extensions": ["gxt"]
    },
    "application/vnd.geoplan": {
      "source": "iana",
      "extensions": ["g2w"]
    },
    "application/vnd.geospace": {
      "source": "iana",
      "extensions": ["g3w"]
    },
    "application/vnd.gerber": {
      "source": "iana"
    },
    "application/vnd.globalplatform.card-content-mgt": {
      "source": "iana"
    },
    "application/vnd.globalplatform.card-content-mgt-response": {
      "source": "iana"
    },
    "application/vnd.gmx": {
      "source": "iana",
      "extensions": ["gmx"]
    },
    "application/vnd.google-apps.document": {
      "compressible": false,
      "extensions": ["gdoc"]
    },
    "application/vnd.google-apps.presentation": {
      "compressible": false,
      "extensions": ["gslides"]
    },
    "application/vnd.google-apps.spreadsheet": {
      "compressible": false,
      "extensions": ["gsheet"]
    },
    "application/vnd.google-earth.kml+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["kml"]
    },
    "application/vnd.google-earth.kmz": {
      "source": "iana",
      "compressible": false,
      "extensions": ["kmz"]
    },
    "application/vnd.gov.sk.e-form+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.gov.sk.e-form+zip": {
      "source": "iana",
      "compressible": false
    },
    "application/vnd.gov.sk.xmldatacontainer+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.grafeq": {
      "source": "iana",
      "extensions": ["gqf","gqs"]
    },
    "application/vnd.gridmp": {
      "source": "iana"
    },
    "application/vnd.groove-account": {
      "source": "iana",
      "extensions": ["gac"]
    },
    "application/vnd.groove-help": {
      "source": "iana",
      "extensions": ["ghf"]
    },
    "application/vnd.groove-identity-message": {
      "source": "iana",
      "extensions": ["gim"]
    },
    "application/vnd.groove-injector": {
      "source": "iana",
      "extensions": ["grv"]
    },
    "application/vnd.groove-tool-message": {
      "source": "iana",
      "extensions": ["gtm"]
    },
    "application/vnd.groove-tool-template": {
      "source": "iana",
      "extensions": ["tpl"]
    },
    "application/vnd.groove-vcard": {
      "source": "iana",
      "extensions": ["vcg"]
    },
    "application/vnd.hal+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.hal+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["hal"]
    },
    "application/vnd.handheld-entertainment+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["zmm"]
    },
    "application/vnd.hbci": {
      "source": "iana",
      "extensions": ["hbci"]
    },
    "application/vnd.hc+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.hcl-bireports": {
      "source": "iana"
    },
    "application/vnd.hdt": {
      "source": "iana"
    },
    "application/vnd.heroku+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.hhe.lesson-player": {
      "source": "iana",
      "extensions": ["les"]
    },
    "application/vnd.hp-hpgl": {
      "source": "iana",
      "extensions": ["hpgl"]
    },
    "application/vnd.hp-hpid": {
      "source": "iana",
      "extensions": ["hpid"]
    },
    "application/vnd.hp-hps": {
      "source": "iana",
      "extensions": ["hps"]
    },
    "application/vnd.hp-jlyt": {
      "source": "iana",
      "extensions": ["jlt"]
    },
    "application/vnd.hp-pcl": {
      "source": "iana",
      "extensions": ["pcl"]
    },
    "application/vnd.hp-pclxl": {
      "source": "iana",
      "extensions": ["pclxl"]
    },
    "application/vnd.httphone": {
      "source": "iana"
    },
    "application/vnd.hydrostatix.sof-data": {
      "source": "iana",
      "extensions": ["sfd-hdstx"]
    },
    "application/vnd.hyper+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.hyper-item+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.hyperdrive+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.hzn-3d-crossword": {
      "source": "iana"
    },
    "application/vnd.ibm.afplinedata": {
      "source": "iana"
    },
    "application/vnd.ibm.electronic-media": {
      "source": "iana"
    },
    "application/vnd.ibm.minipay": {
      "source": "iana",
      "extensions": ["mpy"]
    },
    "application/vnd.ibm.modcap": {
      "source": "iana",
      "extensions": ["afp","listafp","list3820"]
    },
    "application/vnd.ibm.rights-management": {
      "source": "iana",
      "extensions": ["irm"]
    },
    "application/vnd.ibm.secure-container": {
      "source": "iana",
      "extensions": ["sc"]
    },
    "application/vnd.iccprofile": {
      "source": "iana",
      "extensions": ["icc","icm"]
    },
    "application/vnd.ieee.1905": {
      "source": "iana"
    },
    "application/vnd.igloader": {
      "source": "iana",
      "extensions": ["igl"]
    },
    "application/vnd.imagemeter.folder+zip": {
      "source": "iana",
      "compressible": false
    },
    "application/vnd.imagemeter.image+zip": {
      "source": "iana",
      "compressible": false
    },
    "application/vnd.immervision-ivp": {
      "source": "iana",
      "extensions": ["ivp"]
    },
    "application/vnd.immervision-ivu": {
      "source": "iana",
      "extensions": ["ivu"]
    },
    "application/vnd.ims.imsccv1p1": {
      "source": "iana"
    },
    "application/vnd.ims.imsccv1p2": {
      "source": "iana"
    },
    "application/vnd.ims.imsccv1p3": {
      "source": "iana"
    },
    "application/vnd.ims.lis.v2.result+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.ims.lti.v2.toolconsumerprofile+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.ims.lti.v2.toolproxy+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.ims.lti.v2.toolproxy.id+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.ims.lti.v2.toolsettings+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.ims.lti.v2.toolsettings.simple+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.informedcontrol.rms+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.informix-visionary": {
      "source": "iana"
    },
    "application/vnd.infotech.project": {
      "source": "iana"
    },
    "application/vnd.infotech.project+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.innopath.wamp.notification": {
      "source": "iana"
    },
    "application/vnd.insors.igm": {
      "source": "iana",
      "extensions": ["igm"]
    },
    "application/vnd.intercon.formnet": {
      "source": "iana",
      "extensions": ["xpw","xpx"]
    },
    "application/vnd.intergeo": {
      "source": "iana",
      "extensions": ["i2g"]
    },
    "application/vnd.intertrust.digibox": {
      "source": "iana"
    },
    "application/vnd.intertrust.nncp": {
      "source": "iana"
    },
    "application/vnd.intu.qbo": {
      "source": "iana",
      "extensions": ["qbo"]
    },
    "application/vnd.intu.qfx": {
      "source": "iana",
      "extensions": ["qfx"]
    },
    "application/vnd.iptc.g2.catalogitem+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.iptc.g2.conceptitem+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.iptc.g2.knowledgeitem+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.iptc.g2.newsitem+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.iptc.g2.newsmessage+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.iptc.g2.packageitem+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.iptc.g2.planningitem+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.ipunplugged.rcprofile": {
      "source": "iana",
      "extensions": ["rcprofile"]
    },
    "application/vnd.irepository.package+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["irp"]
    },
    "application/vnd.is-xpr": {
      "source": "iana",
      "extensions": ["xpr"]
    },
    "application/vnd.isac.fcs": {
      "source": "iana",
      "extensions": ["fcs"]
    },
    "application/vnd.iso11783-10+zip": {
      "source": "iana",
      "compressible": false
    },
    "application/vnd.jam": {
      "source": "iana",
      "extensions": ["jam"]
    },
    "application/vnd.japannet-directory-service": {
      "source": "iana"
    },
    "application/vnd.japannet-jpnstore-wakeup": {
      "source": "iana"
    },
    "application/vnd.japannet-payment-wakeup": {
      "source": "iana"
    },
    "application/vnd.japannet-registration": {
      "source": "iana"
    },
    "application/vnd.japannet-registration-wakeup": {
      "source": "iana"
    },
    "application/vnd.japannet-setstore-wakeup": {
      "source": "iana"
    },
    "application/vnd.japannet-verification": {
      "source": "iana"
    },
    "application/vnd.japannet-verification-wakeup": {
      "source": "iana"
    },
    "application/vnd.jcp.javame.midlet-rms": {
      "source": "iana",
      "extensions": ["rms"]
    },
    "application/vnd.jisp": {
      "source": "iana",
      "extensions": ["jisp"]
    },
    "application/vnd.joost.joda-archive": {
      "source": "iana",
      "extensions": ["joda"]
    },
    "application/vnd.jsk.isdn-ngn": {
      "source": "iana"
    },
    "application/vnd.kahootz": {
      "source": "iana",
      "extensions": ["ktz","ktr"]
    },
    "application/vnd.kde.karbon": {
      "source": "iana",
      "extensions": ["karbon"]
    },
    "application/vnd.kde.kchart": {
      "source": "iana",
      "extensions": ["chrt"]
    },
    "application/vnd.kde.kformula": {
      "source": "iana",
      "extensions": ["kfo"]
    },
    "application/vnd.kde.kivio": {
      "source": "iana",
      "extensions": ["flw"]
    },
    "application/vnd.kde.kontour": {
      "source": "iana",
      "extensions": ["kon"]
    },
    "application/vnd.kde.kpresenter": {
      "source": "iana",
      "extensions": ["kpr","kpt"]
    },
    "application/vnd.kde.kspread": {
      "source": "iana",
      "extensions": ["ksp"]
    },
    "application/vnd.kde.kword": {
      "source": "iana",
      "extensions": ["kwd","kwt"]
    },
    "application/vnd.kenameaapp": {
      "source": "iana",
      "extensions": ["htke"]
    },
    "application/vnd.kidspiration": {
      "source": "iana",
      "extensions": ["kia"]
    },
    "application/vnd.kinar": {
      "source": "iana",
      "extensions": ["kne","knp"]
    },
    "application/vnd.koan": {
      "source": "iana",
      "extensions": ["skp","skd","skt","skm"]
    },
    "application/vnd.kodak-descriptor": {
      "source": "iana",
      "extensions": ["sse"]
    },
    "application/vnd.las": {
      "source": "iana"
    },
    "application/vnd.las.las+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.las.las+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["lasxml"]
    },
    "application/vnd.laszip": {
      "source": "iana"
    },
    "application/vnd.leap+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.liberty-request+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.llamagraphics.life-balance.desktop": {
      "source": "iana",
      "extensions": ["lbd"]
    },
    "application/vnd.llamagraphics.life-balance.exchange+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["lbe"]
    },
    "application/vnd.logipipe.circuit+zip": {
      "source": "iana",
      "compressible": false
    },
    "application/vnd.loom": {
      "source": "iana"
    },
    "application/vnd.lotus-1-2-3": {
      "source": "iana",
      "extensions": ["123"]
    },
    "application/vnd.lotus-approach": {
      "source": "iana",
      "extensions": ["apr"]
    },
    "application/vnd.lotus-freelance": {
      "source": "iana",
      "extensions": ["pre"]
    },
    "application/vnd.lotus-notes": {
      "source": "iana",
      "extensions": ["nsf"]
    },
    "application/vnd.lotus-organizer": {
      "source": "iana",
      "extensions": ["org"]
    },
    "application/vnd.lotus-screencam": {
      "source": "iana",
      "extensions": ["scm"]
    },
    "application/vnd.lotus-wordpro": {
      "source": "iana",
      "extensions": ["lwp"]
    },
    "application/vnd.macports.portpkg": {
      "source": "iana",
      "extensions": ["portpkg"]
    },
    "application/vnd.mapbox-vector-tile": {
      "source": "iana"
    },
    "application/vnd.marlin.drm.actiontoken+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.marlin.drm.conftoken+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.marlin.drm.license+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.marlin.drm.mdcf": {
      "source": "iana"
    },
    "application/vnd.mason+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.maxmind.maxmind-db": {
      "source": "iana"
    },
    "application/vnd.mcd": {
      "source": "iana",
      "extensions": ["mcd"]
    },
    "application/vnd.medcalcdata": {
      "source": "iana",
      "extensions": ["mc1"]
    },
    "application/vnd.mediastation.cdkey": {
      "source": "iana",
      "extensions": ["cdkey"]
    },
    "application/vnd.meridian-slingshot": {
      "source": "iana"
    },
    "application/vnd.mfer": {
      "source": "iana",
      "extensions": ["mwf"]
    },
    "application/vnd.mfmp": {
      "source": "iana",
      "extensions": ["mfm"]
    },
    "application/vnd.micro+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.micrografx.flo": {
      "source": "iana",
      "extensions": ["flo"]
    },
    "application/vnd.micrografx.igx": {
      "source": "iana",
      "extensions": ["igx"]
    },
    "application/vnd.microsoft.portable-executable": {
      "source": "iana"
    },
    "application/vnd.microsoft.windows.thumbnail-cache": {
      "source": "iana"
    },
    "application/vnd.miele+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.mif": {
      "source": "iana",
      "extensions": ["mif"]
    },
    "application/vnd.minisoft-hp3000-save": {
      "source": "iana"
    },
    "application/vnd.mitsubishi.misty-guard.trustweb": {
      "source": "iana"
    },
    "application/vnd.mobius.daf": {
      "source": "iana",
      "extensions": ["daf"]
    },
    "application/vnd.mobius.dis": {
      "source": "iana",
      "extensions": ["dis"]
    },
    "application/vnd.mobius.mbk": {
      "source": "iana",
      "extensions": ["mbk"]
    },
    "application/vnd.mobius.mqy": {
      "source": "iana",
      "extensions": ["mqy"]
    },
    "application/vnd.mobius.msl": {
      "source": "iana",
      "extensions": ["msl"]
    },
    "application/vnd.mobius.plc": {
      "source": "iana",
      "extensions": ["plc"]
    },
    "application/vnd.mobius.txf": {
      "source": "iana",
      "extensions": ["txf"]
    },
    "application/vnd.mophun.application": {
      "source": "iana",
      "extensions": ["mpn"]
    },
    "application/vnd.mophun.certificate": {
      "source": "iana",
      "extensions": ["mpc"]
    },
    "application/vnd.motorola.flexsuite": {
      "source": "iana"
    },
    "application/vnd.motorola.flexsuite.adsi": {
      "source": "iana"
    },
    "application/vnd.motorola.flexsuite.fis": {
      "source": "iana"
    },
    "application/vnd.motorola.flexsuite.gotap": {
      "source": "iana"
    },
    "application/vnd.motorola.flexsuite.kmr": {
      "source": "iana"
    },
    "application/vnd.motorola.flexsuite.ttc": {
      "source": "iana"
    },
    "application/vnd.motorola.flexsuite.wem": {
      "source": "iana"
    },
    "application/vnd.motorola.iprm": {
      "source": "iana"
    },
    "application/vnd.mozilla.xul+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["xul"]
    },
    "application/vnd.ms-3mfdocument": {
      "source": "iana"
    },
    "application/vnd.ms-artgalry": {
      "source": "iana",
      "extensions": ["cil"]
    },
    "application/vnd.ms-asf": {
      "source": "iana"
    },
    "application/vnd.ms-cab-compressed": {
      "source": "iana",
      "extensions": ["cab"]
    },
    "application/vnd.ms-color.iccprofile": {
      "source": "apache"
    },
    "application/vnd.ms-excel": {
      "source": "iana",
      "compressible": false,
      "extensions": ["xls","xlm","xla","xlc","xlt","xlw"]
    },
    "application/vnd.ms-excel.addin.macroenabled.12": {
      "source": "iana",
      "extensions": ["xlam"]
    },
    "application/vnd.ms-excel.sheet.binary.macroenabled.12": {
      "source": "iana",
      "extensions": ["xlsb"]
    },
    "application/vnd.ms-excel.sheet.macroenabled.12": {
      "source": "iana",
      "extensions": ["xlsm"]
    },
    "application/vnd.ms-excel.template.macroenabled.12": {
      "source": "iana",
      "extensions": ["xltm"]
    },
    "application/vnd.ms-fontobject": {
      "source": "iana",
      "compressible": true,
      "extensions": ["eot"]
    },
    "application/vnd.ms-htmlhelp": {
      "source": "iana",
      "extensions": ["chm"]
    },
    "application/vnd.ms-ims": {
      "source": "iana",
      "extensions": ["ims"]
    },
    "application/vnd.ms-lrm": {
      "source": "iana",
      "extensions": ["lrm"]
    },
    "application/vnd.ms-office.activex+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.ms-officetheme": {
      "source": "iana",
      "extensions": ["thmx"]
    },
    "application/vnd.ms-opentype": {
      "source": "apache",
      "compressible": true
    },
    "application/vnd.ms-outlook": {
      "compressible": false,
      "extensions": ["msg"]
    },
    "application/vnd.ms-package.obfuscated-opentype": {
      "source": "apache"
    },
    "application/vnd.ms-pki.seccat": {
      "source": "apache",
      "extensions": ["cat"]
    },
    "application/vnd.ms-pki.stl": {
      "source": "apache",
      "extensions": ["stl"]
    },
    "application/vnd.ms-playready.initiator+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.ms-powerpoint": {
      "source": "iana",
      "compressible": false,
      "extensions": ["ppt","pps","pot"]
    },
    "application/vnd.ms-powerpoint.addin.macroenabled.12": {
      "source": "iana",
      "extensions": ["ppam"]
    },
    "application/vnd.ms-powerpoint.presentation.macroenabled.12": {
      "source": "iana",
      "extensions": ["pptm"]
    },
    "application/vnd.ms-powerpoint.slide.macroenabled.12": {
      "source": "iana",
      "extensions": ["sldm"]
    },
    "application/vnd.ms-powerpoint.slideshow.macroenabled.12": {
      "source": "iana",
      "extensions": ["ppsm"]
    },
    "application/vnd.ms-powerpoint.template.macroenabled.12": {
      "source": "iana",
      "extensions": ["potm"]
    },
    "application/vnd.ms-printdevicecapabilities+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.ms-printing.printticket+xml": {
      "source": "apache",
      "compressible": true
    },
    "application/vnd.ms-printschematicket+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.ms-project": {
      "source": "iana",
      "extensions": ["mpp","mpt"]
    },
    "application/vnd.ms-tnef": {
      "source": "iana"
    },
    "application/vnd.ms-windows.devicepairing": {
      "source": "iana"
    },
    "application/vnd.ms-windows.nwprinting.oob": {
      "source": "iana"
    },
    "application/vnd.ms-windows.printerpairing": {
      "source": "iana"
    },
    "application/vnd.ms-windows.wsd.oob": {
      "source": "iana"
    },
    "application/vnd.ms-wmdrm.lic-chlg-req": {
      "source": "iana"
    },
    "application/vnd.ms-wmdrm.lic-resp": {
      "source": "iana"
    },
    "application/vnd.ms-wmdrm.meter-chlg-req": {
      "source": "iana"
    },
    "application/vnd.ms-wmdrm.meter-resp": {
      "source": "iana"
    },
    "application/vnd.ms-word.document.macroenabled.12": {
      "source": "iana",
      "extensions": ["docm"]
    },
    "application/vnd.ms-word.template.macroenabled.12": {
      "source": "iana",
      "extensions": ["dotm"]
    },
    "application/vnd.ms-works": {
      "source": "iana",
      "extensions": ["wps","wks","wcm","wdb"]
    },
    "application/vnd.ms-wpl": {
      "source": "iana",
      "extensions": ["wpl"]
    },
    "application/vnd.ms-xpsdocument": {
      "source": "iana",
      "compressible": false,
      "extensions": ["xps"]
    },
    "application/vnd.msa-disk-image": {
      "source": "iana"
    },
    "application/vnd.mseq": {
      "source": "iana",
      "extensions": ["mseq"]
    },
    "application/vnd.msign": {
      "source": "iana"
    },
    "application/vnd.multiad.creator": {
      "source": "iana"
    },
    "application/vnd.multiad.creator.cif": {
      "source": "iana"
    },
    "application/vnd.music-niff": {
      "source": "iana"
    },
    "application/vnd.musician": {
      "source": "iana",
      "extensions": ["mus"]
    },
    "application/vnd.muvee.style": {
      "source": "iana",
      "extensions": ["msty"]
    },
    "application/vnd.mynfc": {
      "source": "iana",
      "extensions": ["taglet"]
    },
    "application/vnd.ncd.control": {
      "source": "iana"
    },
    "application/vnd.ncd.reference": {
      "source": "iana"
    },
    "application/vnd.nearst.inv+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.nervana": {
      "source": "iana"
    },
    "application/vnd.netfpx": {
      "source": "iana"
    },
    "application/vnd.neurolanguage.nlu": {
      "source": "iana",
      "extensions": ["nlu"]
    },
    "application/vnd.nimn": {
      "source": "iana"
    },
    "application/vnd.nintendo.nitro.rom": {
      "source": "iana"
    },
    "application/vnd.nintendo.snes.rom": {
      "source": "iana"
    },
    "application/vnd.nitf": {
      "source": "iana",
      "extensions": ["ntf","nitf"]
    },
    "application/vnd.noblenet-directory": {
      "source": "iana",
      "extensions": ["nnd"]
    },
    "application/vnd.noblenet-sealer": {
      "source": "iana",
      "extensions": ["nns"]
    },
    "application/vnd.noblenet-web": {
      "source": "iana",
      "extensions": ["nnw"]
    },
    "application/vnd.nokia.catalogs": {
      "source": "iana"
    },
    "application/vnd.nokia.conml+wbxml": {
      "source": "iana"
    },
    "application/vnd.nokia.conml+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.nokia.iptv.config+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.nokia.isds-radio-presets": {
      "source": "iana"
    },
    "application/vnd.nokia.landmark+wbxml": {
      "source": "iana"
    },
    "application/vnd.nokia.landmark+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.nokia.landmarkcollection+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.nokia.n-gage.ac+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["ac"]
    },
    "application/vnd.nokia.n-gage.data": {
      "source": "iana",
      "extensions": ["ngdat"]
    },
    "application/vnd.nokia.n-gage.symbian.install": {
      "source": "iana",
      "extensions": ["n-gage"]
    },
    "application/vnd.nokia.ncd": {
      "source": "iana"
    },
    "application/vnd.nokia.pcd+wbxml": {
      "source": "iana"
    },
    "application/vnd.nokia.pcd+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.nokia.radio-preset": {
      "source": "iana",
      "extensions": ["rpst"]
    },
    "application/vnd.nokia.radio-presets": {
      "source": "iana",
      "extensions": ["rpss"]
    },
    "application/vnd.novadigm.edm": {
      "source": "iana",
      "extensions": ["edm"]
    },
    "application/vnd.novadigm.edx": {
      "source": "iana",
      "extensions": ["edx"]
    },
    "application/vnd.novadigm.ext": {
      "source": "iana",
      "extensions": ["ext"]
    },
    "application/vnd.ntt-local.content-share": {
      "source": "iana"
    },
    "application/vnd.ntt-local.file-transfer": {
      "source": "iana"
    },
    "application/vnd.ntt-local.ogw_remote-access": {
      "source": "iana"
    },
    "application/vnd.ntt-local.sip-ta_remote": {
      "source": "iana"
    },
    "application/vnd.ntt-local.sip-ta_tcp_stream": {
      "source": "iana"
    },
    "application/vnd.oasis.opendocument.chart": {
      "source": "iana",
      "extensions": ["odc"]
    },
    "application/vnd.oasis.opendocument.chart-template": {
      "source": "iana",
      "extensions": ["otc"]
    },
    "application/vnd.oasis.opendocument.database": {
      "source": "iana",
      "extensions": ["odb"]
    },
    "application/vnd.oasis.opendocument.formula": {
      "source": "iana",
      "extensions": ["odf"]
    },
    "application/vnd.oasis.opendocument.formula-template": {
      "source": "iana",
      "extensions": ["odft"]
    },
    "application/vnd.oasis.opendocument.graphics": {
      "source": "iana",
      "compressible": false,
      "extensions": ["odg"]
    },
    "application/vnd.oasis.opendocument.graphics-template": {
      "source": "iana",
      "extensions": ["otg"]
    },
    "application/vnd.oasis.opendocument.image": {
      "source": "iana",
      "extensions": ["odi"]
    },
    "application/vnd.oasis.opendocument.image-template": {
      "source": "iana",
      "extensions": ["oti"]
    },
    "application/vnd.oasis.opendocument.presentation": {
      "source": "iana",
      "compressible": false,
      "extensions": ["odp"]
    },
    "application/vnd.oasis.opendocument.presentation-template": {
      "source": "iana",
      "extensions": ["otp"]
    },
    "application/vnd.oasis.opendocument.spreadsheet": {
      "source": "iana",
      "compressible": false,
      "extensions": ["ods"]
    },
    "application/vnd.oasis.opendocument.spreadsheet-template": {
      "source": "iana",
      "extensions": ["ots"]
    },
    "application/vnd.oasis.opendocument.text": {
      "source": "iana",
      "compressible": false,
      "extensions": ["odt"]
    },
    "application/vnd.oasis.opendocument.text-master": {
      "source": "iana",
      "extensions": ["odm"]
    },
    "application/vnd.oasis.opendocument.text-template": {
      "source": "iana",
      "extensions": ["ott"]
    },
    "application/vnd.oasis.opendocument.text-web": {
      "source": "iana",
      "extensions": ["oth"]
    },
    "application/vnd.obn": {
      "source": "iana"
    },
    "application/vnd.ocf+cbor": {
      "source": "iana"
    },
    "application/vnd.oci.image.manifest.v1+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oftn.l10n+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oipf.contentaccessdownload+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oipf.contentaccessstreaming+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oipf.cspg-hexbinary": {
      "source": "iana"
    },
    "application/vnd.oipf.dae.svg+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oipf.dae.xhtml+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oipf.mippvcontrolmessage+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oipf.pae.gem": {
      "source": "iana"
    },
    "application/vnd.oipf.spdiscovery+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oipf.spdlist+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oipf.ueprofile+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oipf.userprofile+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.olpc-sugar": {
      "source": "iana",
      "extensions": ["xo"]
    },
    "application/vnd.oma-scws-config": {
      "source": "iana"
    },
    "application/vnd.oma-scws-http-request": {
      "source": "iana"
    },
    "application/vnd.oma-scws-http-response": {
      "source": "iana"
    },
    "application/vnd.oma.bcast.associated-procedure-parameter+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.bcast.drm-trigger+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.bcast.imd+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.bcast.ltkm": {
      "source": "iana"
    },
    "application/vnd.oma.bcast.notification+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.bcast.provisioningtrigger": {
      "source": "iana"
    },
    "application/vnd.oma.bcast.sgboot": {
      "source": "iana"
    },
    "application/vnd.oma.bcast.sgdd+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.bcast.sgdu": {
      "source": "iana"
    },
    "application/vnd.oma.bcast.simple-symbol-container": {
      "source": "iana"
    },
    "application/vnd.oma.bcast.smartcard-trigger+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.bcast.sprov+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.bcast.stkm": {
      "source": "iana"
    },
    "application/vnd.oma.cab-address-book+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.cab-feature-handler+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.cab-pcc+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.cab-subs-invite+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.cab-user-prefs+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.dcd": {
      "source": "iana"
    },
    "application/vnd.oma.dcdc": {
      "source": "iana"
    },
    "application/vnd.oma.dd2+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["dd2"]
    },
    "application/vnd.oma.drm.risd+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.group-usage-list+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.lwm2m+cbor": {
      "source": "iana"
    },
    "application/vnd.oma.lwm2m+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.lwm2m+tlv": {
      "source": "iana"
    },
    "application/vnd.oma.pal+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.poc.detailed-progress-report+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.poc.final-report+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.poc.groups+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.poc.invocation-descriptor+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.poc.optimized-progress-report+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.push": {
      "source": "iana"
    },
    "application/vnd.oma.scidm.messages+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oma.xcap-directory+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.omads-email+xml": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true
    },
    "application/vnd.omads-file+xml": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true
    },
    "application/vnd.omads-folder+xml": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true
    },
    "application/vnd.omaloc-supl-init": {
      "source": "iana"
    },
    "application/vnd.onepager": {
      "source": "iana"
    },
    "application/vnd.onepagertamp": {
      "source": "iana"
    },
    "application/vnd.onepagertamx": {
      "source": "iana"
    },
    "application/vnd.onepagertat": {
      "source": "iana"
    },
    "application/vnd.onepagertatp": {
      "source": "iana"
    },
    "application/vnd.onepagertatx": {
      "source": "iana"
    },
    "application/vnd.openblox.game+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["obgx"]
    },
    "application/vnd.openblox.game-binary": {
      "source": "iana"
    },
    "application/vnd.openeye.oeb": {
      "source": "iana"
    },
    "application/vnd.openofficeorg.extension": {
      "source": "apache",
      "extensions": ["oxt"]
    },
    "application/vnd.openstreetmap.data+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["osm"]
    },
    "application/vnd.openxmlformats-officedocument.custom-properties+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.customxmlproperties+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.drawing+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.drawingml.chart+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.drawingml.chartshapes+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.drawingml.diagramcolors+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.drawingml.diagramdata+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.drawingml.diagramlayout+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.drawingml.diagramstyle+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.extended-properties+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.presentationml.commentauthors+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.presentationml.comments+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.presentationml.handoutmaster+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.presentationml.notesmaster+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.presentationml.notesslide+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
      "source": "iana",
      "compressible": false,
      "extensions": ["pptx"]
    },
    "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.presentationml.presprops+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.presentationml.slide": {
      "source": "iana",
      "extensions": ["sldx"]
    },
    "application/vnd.openxmlformats-officedocument.presentationml.slide+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.presentationml.slidelayout+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.presentationml.slidemaster+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.presentationml.slideshow": {
      "source": "iana",
      "extensions": ["ppsx"]
    },
    "application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.presentationml.slideupdateinfo+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.presentationml.tablestyles+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.presentationml.tags+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.presentationml.template": {
      "source": "iana",
      "extensions": ["potx"]
    },
    "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.presentationml.viewprops+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.calcchain+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.dialogsheet+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.externallink+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotcachedefinition+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotcacherecords+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.pivottable+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.querytable+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.revisionheaders+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.revisionlog+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedstrings+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
      "source": "iana",
      "compressible": false,
      "extensions": ["xlsx"]
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheetmetadata+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.tablesinglecells+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.template": {
      "source": "iana",
      "extensions": ["xltx"]
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.usernames+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.volatiledependencies+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.theme+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.themeoverride+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.vmldrawing": {
      "source": "iana"
    },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      "source": "iana",
      "compressible": false,
      "extensions": ["docx"]
    },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.fonttable+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.template": {
      "source": "iana",
      "extensions": ["dotx"]
    },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.websettings+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-package.core-properties+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.openxmlformats-package.relationships+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oracle.resource+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.orange.indata": {
      "source": "iana"
    },
    "application/vnd.osa.netdeploy": {
      "source": "iana"
    },
    "application/vnd.osgeo.mapguide.package": {
      "source": "iana",
      "extensions": ["mgp"]
    },
    "application/vnd.osgi.bundle": {
      "source": "iana"
    },
    "application/vnd.osgi.dp": {
      "source": "iana",
      "extensions": ["dp"]
    },
    "application/vnd.osgi.subsystem": {
      "source": "iana",
      "extensions": ["esa"]
    },
    "application/vnd.otps.ct-kip+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.oxli.countgraph": {
      "source": "iana"
    },
    "application/vnd.pagerduty+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.palm": {
      "source": "iana",
      "extensions": ["pdb","pqa","oprc"]
    },
    "application/vnd.panoply": {
      "source": "iana"
    },
    "application/vnd.paos.xml": {
      "source": "iana"
    },
    "application/vnd.patentdive": {
      "source": "iana"
    },
    "application/vnd.patientecommsdoc": {
      "source": "iana"
    },
    "application/vnd.pawaafile": {
      "source": "iana",
      "extensions": ["paw"]
    },
    "application/vnd.pcos": {
      "source": "iana"
    },
    "application/vnd.pg.format": {
      "source": "iana",
      "extensions": ["str"]
    },
    "application/vnd.pg.osasli": {
      "source": "iana",
      "extensions": ["ei6"]
    },
    "application/vnd.piaccess.application-licence": {
      "source": "iana"
    },
    "application/vnd.picsel": {
      "source": "iana",
      "extensions": ["efif"]
    },
    "application/vnd.pmi.widget": {
      "source": "iana",
      "extensions": ["wg"]
    },
    "application/vnd.poc.group-advertisement+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.pocketlearn": {
      "source": "iana",
      "extensions": ["plf"]
    },
    "application/vnd.powerbuilder6": {
      "source": "iana",
      "extensions": ["pbd"]
    },
    "application/vnd.powerbuilder6-s": {
      "source": "iana"
    },
    "application/vnd.powerbuilder7": {
      "source": "iana"
    },
    "application/vnd.powerbuilder7-s": {
      "source": "iana"
    },
    "application/vnd.powerbuilder75": {
      "source": "iana"
    },
    "application/vnd.powerbuilder75-s": {
      "source": "iana"
    },
    "application/vnd.preminet": {
      "source": "iana"
    },
    "application/vnd.previewsystems.box": {
      "source": "iana",
      "extensions": ["box"]
    },
    "application/vnd.proteus.magazine": {
      "source": "iana",
      "extensions": ["mgz"]
    },
    "application/vnd.psfs": {
      "source": "iana"
    },
    "application/vnd.publishare-delta-tree": {
      "source": "iana",
      "extensions": ["qps"]
    },
    "application/vnd.pvi.ptid1": {
      "source": "iana",
      "extensions": ["ptid"]
    },
    "application/vnd.pwg-multiplexed": {
      "source": "iana"
    },
    "application/vnd.pwg-xhtml-print+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.qualcomm.brew-app-res": {
      "source": "iana"
    },
    "application/vnd.quarantainenet": {
      "source": "iana"
    },
    "application/vnd.quark.quarkxpress": {
      "source": "iana",
      "extensions": ["qxd","qxt","qwd","qwt","qxl","qxb"]
    },
    "application/vnd.quobject-quoxdocument": {
      "source": "iana"
    },
    "application/vnd.radisys.moml+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.radisys.msml+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.radisys.msml-audit+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.radisys.msml-audit-conf+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.radisys.msml-audit-conn+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.radisys.msml-audit-dialog+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.radisys.msml-audit-stream+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.radisys.msml-conf+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.radisys.msml-dialog+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.radisys.msml-dialog-base+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.radisys.msml-dialog-fax-detect+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.radisys.msml-dialog-fax-sendrecv+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.radisys.msml-dialog-group+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.radisys.msml-dialog-speech+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.radisys.msml-dialog-transform+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.rainstor.data": {
      "source": "iana"
    },
    "application/vnd.rapid": {
      "source": "iana"
    },
    "application/vnd.rar": {
      "source": "iana",
      "extensions": ["rar"]
    },
    "application/vnd.realvnc.bed": {
      "source": "iana",
      "extensions": ["bed"]
    },
    "application/vnd.recordare.musicxml": {
      "source": "iana",
      "extensions": ["mxl"]
    },
    "application/vnd.recordare.musicxml+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["musicxml"]
    },
    "application/vnd.renlearn.rlprint": {
      "source": "iana"
    },
    "application/vnd.restful+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.rig.cryptonote": {
      "source": "iana",
      "extensions": ["cryptonote"]
    },
    "application/vnd.rim.cod": {
      "source": "apache",
      "extensions": ["cod"]
    },
    "application/vnd.rn-realmedia": {
      "source": "apache",
      "extensions": ["rm"]
    },
    "application/vnd.rn-realmedia-vbr": {
      "source": "apache",
      "extensions": ["rmvb"]
    },
    "application/vnd.route66.link66+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["link66"]
    },
    "application/vnd.rs-274x": {
      "source": "iana"
    },
    "application/vnd.ruckus.download": {
      "source": "iana"
    },
    "application/vnd.s3sms": {
      "source": "iana"
    },
    "application/vnd.sailingtracker.track": {
      "source": "iana",
      "extensions": ["st"]
    },
    "application/vnd.sar": {
      "source": "iana"
    },
    "application/vnd.sbm.cid": {
      "source": "iana"
    },
    "application/vnd.sbm.mid2": {
      "source": "iana"
    },
    "application/vnd.scribus": {
      "source": "iana"
    },
    "application/vnd.sealed.3df": {
      "source": "iana"
    },
    "application/vnd.sealed.csf": {
      "source": "iana"
    },
    "application/vnd.sealed.doc": {
      "source": "iana"
    },
    "application/vnd.sealed.eml": {
      "source": "iana"
    },
    "application/vnd.sealed.mht": {
      "source": "iana"
    },
    "application/vnd.sealed.net": {
      "source": "iana"
    },
    "application/vnd.sealed.ppt": {
      "source": "iana"
    },
    "application/vnd.sealed.tiff": {
      "source": "iana"
    },
    "application/vnd.sealed.xls": {
      "source": "iana"
    },
    "application/vnd.sealedmedia.softseal.html": {
      "source": "iana"
    },
    "application/vnd.sealedmedia.softseal.pdf": {
      "source": "iana"
    },
    "application/vnd.seemail": {
      "source": "iana",
      "extensions": ["see"]
    },
    "application/vnd.sema": {
      "source": "iana",
      "extensions": ["sema"]
    },
    "application/vnd.semd": {
      "source": "iana",
      "extensions": ["semd"]
    },
    "application/vnd.semf": {
      "source": "iana",
      "extensions": ["semf"]
    },
    "application/vnd.shade-save-file": {
      "source": "iana"
    },
    "application/vnd.shana.informed.formdata": {
      "source": "iana",
      "extensions": ["ifm"]
    },
    "application/vnd.shana.informed.formtemplate": {
      "source": "iana",
      "extensions": ["itp"]
    },
    "application/vnd.shana.informed.interchange": {
      "source": "iana",
      "extensions": ["iif"]
    },
    "application/vnd.shana.informed.package": {
      "source": "iana",
      "extensions": ["ipk"]
    },
    "application/vnd.shootproof+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.shopkick+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.shp": {
      "source": "iana"
    },
    "application/vnd.shx": {
      "source": "iana"
    },
    "application/vnd.sigrok.session": {
      "source": "iana"
    },
    "application/vnd.simtech-mindmapper": {
      "source": "iana",
      "extensions": ["twd","twds"]
    },
    "application/vnd.siren+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.smaf": {
      "source": "iana",
      "extensions": ["mmf"]
    },
    "application/vnd.smart.notebook": {
      "source": "iana"
    },
    "application/vnd.smart.teacher": {
      "source": "iana",
      "extensions": ["teacher"]
    },
    "application/vnd.snesdev-page-table": {
      "source": "iana"
    },
    "application/vnd.software602.filler.form+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["fo"]
    },
    "application/vnd.software602.filler.form-xml-zip": {
      "source": "iana"
    },
    "application/vnd.solent.sdkm+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["sdkm","sdkd"]
    },
    "application/vnd.spotfire.dxp": {
      "source": "iana",
      "extensions": ["dxp"]
    },
    "application/vnd.spotfire.sfs": {
      "source": "iana",
      "extensions": ["sfs"]
    },
    "application/vnd.sqlite3": {
      "source": "iana"
    },
    "application/vnd.sss-cod": {
      "source": "iana"
    },
    "application/vnd.sss-dtf": {
      "source": "iana"
    },
    "application/vnd.sss-ntf": {
      "source": "iana"
    },
    "application/vnd.stardivision.calc": {
      "source": "apache",
      "extensions": ["sdc"]
    },
    "application/vnd.stardivision.draw": {
      "source": "apache",
      "extensions": ["sda"]
    },
    "application/vnd.stardivision.impress": {
      "source": "apache",
      "extensions": ["sdd"]
    },
    "application/vnd.stardivision.math": {
      "source": "apache",
      "extensions": ["smf"]
    },
    "application/vnd.stardivision.writer": {
      "source": "apache",
      "extensions": ["sdw","vor"]
    },
    "application/vnd.stardivision.writer-global": {
      "source": "apache",
      "extensions": ["sgl"]
    },
    "application/vnd.stepmania.package": {
      "source": "iana",
      "extensions": ["smzip"]
    },
    "application/vnd.stepmania.stepchart": {
      "source": "iana",
      "extensions": ["sm"]
    },
    "application/vnd.street-stream": {
      "source": "iana"
    },
    "application/vnd.sun.wadl+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["wadl"]
    },
    "application/vnd.sun.xml.calc": {
      "source": "apache",
      "extensions": ["sxc"]
    },
    "application/vnd.sun.xml.calc.template": {
      "source": "apache",
      "extensions": ["stc"]
    },
    "application/vnd.sun.xml.draw": {
      "source": "apache",
      "extensions": ["sxd"]
    },
    "application/vnd.sun.xml.draw.template": {
      "source": "apache",
      "extensions": ["std"]
    },
    "application/vnd.sun.xml.impress": {
      "source": "apache",
      "extensions": ["sxi"]
    },
    "application/vnd.sun.xml.impress.template": {
      "source": "apache",
      "extensions": ["sti"]
    },
    "application/vnd.sun.xml.math": {
      "source": "apache",
      "extensions": ["sxm"]
    },
    "application/vnd.sun.xml.writer": {
      "source": "apache",
      "extensions": ["sxw"]
    },
    "application/vnd.sun.xml.writer.global": {
      "source": "apache",
      "extensions": ["sxg"]
    },
    "application/vnd.sun.xml.writer.template": {
      "source": "apache",
      "extensions": ["stw"]
    },
    "application/vnd.sus-calendar": {
      "source": "iana",
      "extensions": ["sus","susp"]
    },
    "application/vnd.svd": {
      "source": "iana",
      "extensions": ["svd"]
    },
    "application/vnd.swiftview-ics": {
      "source": "iana"
    },
    "application/vnd.sycle+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.symbian.install": {
      "source": "apache",
      "extensions": ["sis","sisx"]
    },
    "application/vnd.syncml+xml": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true,
      "extensions": ["xsm"]
    },
    "application/vnd.syncml.dm+wbxml": {
      "source": "iana",
      "charset": "UTF-8",
      "extensions": ["bdm"]
    },
    "application/vnd.syncml.dm+xml": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true,
      "extensions": ["xdm"]
    },
    "application/vnd.syncml.dm.notification": {
      "source": "iana"
    },
    "application/vnd.syncml.dmddf+wbxml": {
      "source": "iana"
    },
    "application/vnd.syncml.dmddf+xml": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true,
      "extensions": ["ddf"]
    },
    "application/vnd.syncml.dmtnds+wbxml": {
      "source": "iana"
    },
    "application/vnd.syncml.dmtnds+xml": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true
    },
    "application/vnd.syncml.ds.notification": {
      "source": "iana"
    },
    "application/vnd.tableschema+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.tao.intent-module-archive": {
      "source": "iana",
      "extensions": ["tao"]
    },
    "application/vnd.tcpdump.pcap": {
      "source": "iana",
      "extensions": ["pcap","cap","dmp"]
    },
    "application/vnd.think-cell.ppttc+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.tmd.mediaflex.api+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.tml": {
      "source": "iana"
    },
    "application/vnd.tmobile-livetv": {
      "source": "iana",
      "extensions": ["tmo"]
    },
    "application/vnd.tri.onesource": {
      "source": "iana"
    },
    "application/vnd.trid.tpt": {
      "source": "iana",
      "extensions": ["tpt"]
    },
    "application/vnd.triscape.mxs": {
      "source": "iana",
      "extensions": ["mxs"]
    },
    "application/vnd.trueapp": {
      "source": "iana",
      "extensions": ["tra"]
    },
    "application/vnd.truedoc": {
      "source": "iana"
    },
    "application/vnd.ubisoft.webplayer": {
      "source": "iana"
    },
    "application/vnd.ufdl": {
      "source": "iana",
      "extensions": ["ufd","ufdl"]
    },
    "application/vnd.uiq.theme": {
      "source": "iana",
      "extensions": ["utz"]
    },
    "application/vnd.umajin": {
      "source": "iana",
      "extensions": ["umj"]
    },
    "application/vnd.unity": {
      "source": "iana",
      "extensions": ["unityweb"]
    },
    "application/vnd.uoml+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["uoml"]
    },
    "application/vnd.uplanet.alert": {
      "source": "iana"
    },
    "application/vnd.uplanet.alert-wbxml": {
      "source": "iana"
    },
    "application/vnd.uplanet.bearer-choice": {
      "source": "iana"
    },
    "application/vnd.uplanet.bearer-choice-wbxml": {
      "source": "iana"
    },
    "application/vnd.uplanet.cacheop": {
      "source": "iana"
    },
    "application/vnd.uplanet.cacheop-wbxml": {
      "source": "iana"
    },
    "application/vnd.uplanet.channel": {
      "source": "iana"
    },
    "application/vnd.uplanet.channel-wbxml": {
      "source": "iana"
    },
    "application/vnd.uplanet.list": {
      "source": "iana"
    },
    "application/vnd.uplanet.list-wbxml": {
      "source": "iana"
    },
    "application/vnd.uplanet.listcmd": {
      "source": "iana"
    },
    "application/vnd.uplanet.listcmd-wbxml": {
      "source": "iana"
    },
    "application/vnd.uplanet.signal": {
      "source": "iana"
    },
    "application/vnd.uri-map": {
      "source": "iana"
    },
    "application/vnd.valve.source.material": {
      "source": "iana"
    },
    "application/vnd.vcx": {
      "source": "iana",
      "extensions": ["vcx"]
    },
    "application/vnd.vd-study": {
      "source": "iana"
    },
    "application/vnd.vectorworks": {
      "source": "iana"
    },
    "application/vnd.vel+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.verimatrix.vcas": {
      "source": "iana"
    },
    "application/vnd.veryant.thin": {
      "source": "iana"
    },
    "application/vnd.ves.encrypted": {
      "source": "iana"
    },
    "application/vnd.vidsoft.vidconference": {
      "source": "iana"
    },
    "application/vnd.visio": {
      "source": "iana",
      "extensions": ["vsd","vst","vss","vsw"]
    },
    "application/vnd.visionary": {
      "source": "iana",
      "extensions": ["vis"]
    },
    "application/vnd.vividence.scriptfile": {
      "source": "iana"
    },
    "application/vnd.vsf": {
      "source": "iana",
      "extensions": ["vsf"]
    },
    "application/vnd.wap.sic": {
      "source": "iana"
    },
    "application/vnd.wap.slc": {
      "source": "iana"
    },
    "application/vnd.wap.wbxml": {
      "source": "iana",
      "charset": "UTF-8",
      "extensions": ["wbxml"]
    },
    "application/vnd.wap.wmlc": {
      "source": "iana",
      "extensions": ["wmlc"]
    },
    "application/vnd.wap.wmlscriptc": {
      "source": "iana",
      "extensions": ["wmlsc"]
    },
    "application/vnd.webturbo": {
      "source": "iana",
      "extensions": ["wtb"]
    },
    "application/vnd.wfa.p2p": {
      "source": "iana"
    },
    "application/vnd.wfa.wsc": {
      "source": "iana"
    },
    "application/vnd.windows.devicepairing": {
      "source": "iana"
    },
    "application/vnd.wmc": {
      "source": "iana"
    },
    "application/vnd.wmf.bootstrap": {
      "source": "iana"
    },
    "application/vnd.wolfram.mathematica": {
      "source": "iana"
    },
    "application/vnd.wolfram.mathematica.package": {
      "source": "iana"
    },
    "application/vnd.wolfram.player": {
      "source": "iana",
      "extensions": ["nbp"]
    },
    "application/vnd.wordperfect": {
      "source": "iana",
      "extensions": ["wpd"]
    },
    "application/vnd.wqd": {
      "source": "iana",
      "extensions": ["wqd"]
    },
    "application/vnd.wrq-hp3000-labelled": {
      "source": "iana"
    },
    "application/vnd.wt.stf": {
      "source": "iana",
      "extensions": ["stf"]
    },
    "application/vnd.wv.csp+wbxml": {
      "source": "iana"
    },
    "application/vnd.wv.csp+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.wv.ssp+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.xacml+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.xara": {
      "source": "iana",
      "extensions": ["xar"]
    },
    "application/vnd.xfdl": {
      "source": "iana",
      "extensions": ["xfdl"]
    },
    "application/vnd.xfdl.webform": {
      "source": "iana"
    },
    "application/vnd.xmi+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/vnd.xmpie.cpkg": {
      "source": "iana"
    },
    "application/vnd.xmpie.dpkg": {
      "source": "iana"
    },
    "application/vnd.xmpie.plan": {
      "source": "iana"
    },
    "application/vnd.xmpie.ppkg": {
      "source": "iana"
    },
    "application/vnd.xmpie.xlim": {
      "source": "iana"
    },
    "application/vnd.yamaha.hv-dic": {
      "source": "iana",
      "extensions": ["hvd"]
    },
    "application/vnd.yamaha.hv-script": {
      "source": "iana",
      "extensions": ["hvs"]
    },
    "application/vnd.yamaha.hv-voice": {
      "source": "iana",
      "extensions": ["hvp"]
    },
    "application/vnd.yamaha.openscoreformat": {
      "source": "iana",
      "extensions": ["osf"]
    },
    "application/vnd.yamaha.openscoreformat.osfpvg+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["osfpvg"]
    },
    "application/vnd.yamaha.remote-setup": {
      "source": "iana"
    },
    "application/vnd.yamaha.smaf-audio": {
      "source": "iana",
      "extensions": ["saf"]
    },
    "application/vnd.yamaha.smaf-phrase": {
      "source": "iana",
      "extensions": ["spf"]
    },
    "application/vnd.yamaha.through-ngn": {
      "source": "iana"
    },
    "application/vnd.yamaha.tunnel-udpencap": {
      "source": "iana"
    },
    "application/vnd.yaoweme": {
      "source": "iana"
    },
    "application/vnd.yellowriver-custom-menu": {
      "source": "iana",
      "extensions": ["cmp"]
    },
    "application/vnd.youtube.yt": {
      "source": "iana"
    },
    "application/vnd.zul": {
      "source": "iana",
      "extensions": ["zir","zirz"]
    },
    "application/vnd.zzazz.deck+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["zaz"]
    },
    "application/voicexml+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["vxml"]
    },
    "application/voucher-cms+json": {
      "source": "iana",
      "compressible": true
    },
    "application/vq-rtcpxr": {
      "source": "iana"
    },
    "application/wasm": {
      "compressible": true,
      "extensions": ["wasm"]
    },
    "application/watcherinfo+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/webpush-options+json": {
      "source": "iana",
      "compressible": true
    },
    "application/whoispp-query": {
      "source": "iana"
    },
    "application/whoispp-response": {
      "source": "iana"
    },
    "application/widget": {
      "source": "iana",
      "extensions": ["wgt"]
    },
    "application/winhlp": {
      "source": "apache",
      "extensions": ["hlp"]
    },
    "application/wita": {
      "source": "iana"
    },
    "application/wordperfect5.1": {
      "source": "iana"
    },
    "application/wsdl+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["wsdl"]
    },
    "application/wspolicy+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["wspolicy"]
    },
    "application/x-7z-compressed": {
      "source": "apache",
      "compressible": false,
      "extensions": ["7z"]
    },
    "application/x-abiword": {
      "source": "apache",
      "extensions": ["abw"]
    },
    "application/x-ace-compressed": {
      "source": "apache",
      "extensions": ["ace"]
    },
    "application/x-amf": {
      "source": "apache"
    },
    "application/x-apple-diskimage": {
      "source": "apache",
      "extensions": ["dmg"]
    },
    "application/x-arj": {
      "compressible": false,
      "extensions": ["arj"]
    },
    "application/x-authorware-bin": {
      "source": "apache",
      "extensions": ["aab","x32","u32","vox"]
    },
    "application/x-authorware-map": {
      "source": "apache",
      "extensions": ["aam"]
    },
    "application/x-authorware-seg": {
      "source": "apache",
      "extensions": ["aas"]
    },
    "application/x-bcpio": {
      "source": "apache",
      "extensions": ["bcpio"]
    },
    "application/x-bdoc": {
      "compressible": false,
      "extensions": ["bdoc"]
    },
    "application/x-bittorrent": {
      "source": "apache",
      "extensions": ["torrent"]
    },
    "application/x-blorb": {
      "source": "apache",
      "extensions": ["blb","blorb"]
    },
    "application/x-bzip": {
      "source": "apache",
      "compressible": false,
      "extensions": ["bz"]
    },
    "application/x-bzip2": {
      "source": "apache",
      "compressible": false,
      "extensions": ["bz2","boz"]
    },
    "application/x-cbr": {
      "source": "apache",
      "extensions": ["cbr","cba","cbt","cbz","cb7"]
    },
    "application/x-cdlink": {
      "source": "apache",
      "extensions": ["vcd"]
    },
    "application/x-cfs-compressed": {
      "source": "apache",
      "extensions": ["cfs"]
    },
    "application/x-chat": {
      "source": "apache",
      "extensions": ["chat"]
    },
    "application/x-chess-pgn": {
      "source": "apache",
      "extensions": ["pgn"]
    },
    "application/x-chrome-extension": {
      "extensions": ["crx"]
    },
    "application/x-cocoa": {
      "source": "nginx",
      "extensions": ["cco"]
    },
    "application/x-compress": {
      "source": "apache"
    },
    "application/x-conference": {
      "source": "apache",
      "extensions": ["nsc"]
    },
    "application/x-cpio": {
      "source": "apache",
      "extensions": ["cpio"]
    },
    "application/x-csh": {
      "source": "apache",
      "extensions": ["csh"]
    },
    "application/x-deb": {
      "compressible": false
    },
    "application/x-debian-package": {
      "source": "apache",
      "extensions": ["deb","udeb"]
    },
    "application/x-dgc-compressed": {
      "source": "apache",
      "extensions": ["dgc"]
    },
    "application/x-director": {
      "source": "apache",
      "extensions": ["dir","dcr","dxr","cst","cct","cxt","w3d","fgd","swa"]
    },
    "application/x-doom": {
      "source": "apache",
      "extensions": ["wad"]
    },
    "application/x-dtbncx+xml": {
      "source": "apache",
      "compressible": true,
      "extensions": ["ncx"]
    },
    "application/x-dtbook+xml": {
      "source": "apache",
      "compressible": true,
      "extensions": ["dtb"]
    },
    "application/x-dtbresource+xml": {
      "source": "apache",
      "compressible": true,
      "extensions": ["res"]
    },
    "application/x-dvi": {
      "source": "apache",
      "compressible": false,
      "extensions": ["dvi"]
    },
    "application/x-envoy": {
      "source": "apache",
      "extensions": ["evy"]
    },
    "application/x-eva": {
      "source": "apache",
      "extensions": ["eva"]
    },
    "application/x-font-bdf": {
      "source": "apache",
      "extensions": ["bdf"]
    },
    "application/x-font-dos": {
      "source": "apache"
    },
    "application/x-font-framemaker": {
      "source": "apache"
    },
    "application/x-font-ghostscript": {
      "source": "apache",
      "extensions": ["gsf"]
    },
    "application/x-font-libgrx": {
      "source": "apache"
    },
    "application/x-font-linux-psf": {
      "source": "apache",
      "extensions": ["psf"]
    },
    "application/x-font-pcf": {
      "source": "apache",
      "extensions": ["pcf"]
    },
    "application/x-font-snf": {
      "source": "apache",
      "extensions": ["snf"]
    },
    "application/x-font-speedo": {
      "source": "apache"
    },
    "application/x-font-sunos-news": {
      "source": "apache"
    },
    "application/x-font-type1": {
      "source": "apache",
      "extensions": ["pfa","pfb","pfm","afm"]
    },
    "application/x-font-vfont": {
      "source": "apache"
    },
    "application/x-freearc": {
      "source": "apache",
      "extensions": ["arc"]
    },
    "application/x-futuresplash": {
      "source": "apache",
      "extensions": ["spl"]
    },
    "application/x-gca-compressed": {
      "source": "apache",
      "extensions": ["gca"]
    },
    "application/x-glulx": {
      "source": "apache",
      "extensions": ["ulx"]
    },
    "application/x-gnumeric": {
      "source": "apache",
      "extensions": ["gnumeric"]
    },
    "application/x-gramps-xml": {
      "source": "apache",
      "extensions": ["gramps"]
    },
    "application/x-gtar": {
      "source": "apache",
      "extensions": ["gtar"]
    },
    "application/x-gzip": {
      "source": "apache"
    },
    "application/x-hdf": {
      "source": "apache",
      "extensions": ["hdf"]
    },
    "application/x-httpd-php": {
      "compressible": true,
      "extensions": ["php"]
    },
    "application/x-install-instructions": {
      "source": "apache",
      "extensions": ["install"]
    },
    "application/x-iso9660-image": {
      "source": "apache",
      "extensions": ["iso"]
    },
    "application/x-java-archive-diff": {
      "source": "nginx",
      "extensions": ["jardiff"]
    },
    "application/x-java-jnlp-file": {
      "source": "apache",
      "compressible": false,
      "extensions": ["jnlp"]
    },
    "application/x-javascript": {
      "compressible": true
    },
    "application/x-keepass2": {
      "extensions": ["kdbx"]
    },
    "application/x-latex": {
      "source": "apache",
      "compressible": false,
      "extensions": ["latex"]
    },
    "application/x-lua-bytecode": {
      "extensions": ["luac"]
    },
    "application/x-lzh-compressed": {
      "source": "apache",
      "extensions": ["lzh","lha"]
    },
    "application/x-makeself": {
      "source": "nginx",
      "extensions": ["run"]
    },
    "application/x-mie": {
      "source": "apache",
      "extensions": ["mie"]
    },
    "application/x-mobipocket-ebook": {
      "source": "apache",
      "extensions": ["prc","mobi"]
    },
    "application/x-mpegurl": {
      "compressible": false
    },
    "application/x-ms-application": {
      "source": "apache",
      "extensions": ["application"]
    },
    "application/x-ms-shortcut": {
      "source": "apache",
      "extensions": ["lnk"]
    },
    "application/x-ms-wmd": {
      "source": "apache",
      "extensions": ["wmd"]
    },
    "application/x-ms-wmz": {
      "source": "apache",
      "extensions": ["wmz"]
    },
    "application/x-ms-xbap": {
      "source": "apache",
      "extensions": ["xbap"]
    },
    "application/x-msaccess": {
      "source": "apache",
      "extensions": ["mdb"]
    },
    "application/x-msbinder": {
      "source": "apache",
      "extensions": ["obd"]
    },
    "application/x-mscardfile": {
      "source": "apache",
      "extensions": ["crd"]
    },
    "application/x-msclip": {
      "source": "apache",
      "extensions": ["clp"]
    },
    "application/x-msdos-program": {
      "extensions": ["exe"]
    },
    "application/x-msdownload": {
      "source": "apache",
      "extensions": ["exe","dll","com","bat","msi"]
    },
    "application/x-msmediaview": {
      "source": "apache",
      "extensions": ["mvb","m13","m14"]
    },
    "application/x-msmetafile": {
      "source": "apache",
      "extensions": ["wmf","wmz","emf","emz"]
    },
    "application/x-msmoney": {
      "source": "apache",
      "extensions": ["mny"]
    },
    "application/x-mspublisher": {
      "source": "apache",
      "extensions": ["pub"]
    },
    "application/x-msschedule": {
      "source": "apache",
      "extensions": ["scd"]
    },
    "application/x-msterminal": {
      "source": "apache",
      "extensions": ["trm"]
    },
    "application/x-mswrite": {
      "source": "apache",
      "extensions": ["wri"]
    },
    "application/x-netcdf": {
      "source": "apache",
      "extensions": ["nc","cdf"]
    },
    "application/x-ns-proxy-autoconfig": {
      "compressible": true,
      "extensions": ["pac"]
    },
    "application/x-nzb": {
      "source": "apache",
      "extensions": ["nzb"]
    },
    "application/x-perl": {
      "source": "nginx",
      "extensions": ["pl","pm"]
    },
    "application/x-pilot": {
      "source": "nginx",
      "extensions": ["prc","pdb"]
    },
    "application/x-pkcs12": {
      "source": "apache",
      "compressible": false,
      "extensions": ["p12","pfx"]
    },
    "application/x-pkcs7-certificates": {
      "source": "apache",
      "extensions": ["p7b","spc"]
    },
    "application/x-pkcs7-certreqresp": {
      "source": "apache",
      "extensions": ["p7r"]
    },
    "application/x-pki-message": {
      "source": "iana"
    },
    "application/x-rar-compressed": {
      "source": "apache",
      "compressible": false,
      "extensions": ["rar"]
    },
    "application/x-redhat-package-manager": {
      "source": "nginx",
      "extensions": ["rpm"]
    },
    "application/x-research-info-systems": {
      "source": "apache",
      "extensions": ["ris"]
    },
    "application/x-sea": {
      "source": "nginx",
      "extensions": ["sea"]
    },
    "application/x-sh": {
      "source": "apache",
      "compressible": true,
      "extensions": ["sh"]
    },
    "application/x-shar": {
      "source": "apache",
      "extensions": ["shar"]
    },
    "application/x-shockwave-flash": {
      "source": "apache",
      "compressible": false,
      "extensions": ["swf"]
    },
    "application/x-silverlight-app": {
      "source": "apache",
      "extensions": ["xap"]
    },
    "application/x-sql": {
      "source": "apache",
      "extensions": ["sql"]
    },
    "application/x-stuffit": {
      "source": "apache",
      "compressible": false,
      "extensions": ["sit"]
    },
    "application/x-stuffitx": {
      "source": "apache",
      "extensions": ["sitx"]
    },
    "application/x-subrip": {
      "source": "apache",
      "extensions": ["srt"]
    },
    "application/x-sv4cpio": {
      "source": "apache",
      "extensions": ["sv4cpio"]
    },
    "application/x-sv4crc": {
      "source": "apache",
      "extensions": ["sv4crc"]
    },
    "application/x-t3vm-image": {
      "source": "apache",
      "extensions": ["t3"]
    },
    "application/x-tads": {
      "source": "apache",
      "extensions": ["gam"]
    },
    "application/x-tar": {
      "source": "apache",
      "compressible": true,
      "extensions": ["tar"]
    },
    "application/x-tcl": {
      "source": "apache",
      "extensions": ["tcl","tk"]
    },
    "application/x-tex": {
      "source": "apache",
      "extensions": ["tex"]
    },
    "application/x-tex-tfm": {
      "source": "apache",
      "extensions": ["tfm"]
    },
    "application/x-texinfo": {
      "source": "apache",
      "extensions": ["texinfo","texi"]
    },
    "application/x-tgif": {
      "source": "apache",
      "extensions": ["obj"]
    },
    "application/x-ustar": {
      "source": "apache",
      "extensions": ["ustar"]
    },
    "application/x-virtualbox-hdd": {
      "compressible": true,
      "extensions": ["hdd"]
    },
    "application/x-virtualbox-ova": {
      "compressible": true,
      "extensions": ["ova"]
    },
    "application/x-virtualbox-ovf": {
      "compressible": true,
      "extensions": ["ovf"]
    },
    "application/x-virtualbox-vbox": {
      "compressible": true,
      "extensions": ["vbox"]
    },
    "application/x-virtualbox-vbox-extpack": {
      "compressible": false,
      "extensions": ["vbox-extpack"]
    },
    "application/x-virtualbox-vdi": {
      "compressible": true,
      "extensions": ["vdi"]
    },
    "application/x-virtualbox-vhd": {
      "compressible": true,
      "extensions": ["vhd"]
    },
    "application/x-virtualbox-vmdk": {
      "compressible": true,
      "extensions": ["vmdk"]
    },
    "application/x-wais-source": {
      "source": "apache",
      "extensions": ["src"]
    },
    "application/x-web-app-manifest+json": {
      "compressible": true,
      "extensions": ["webapp"]
    },
    "application/x-www-form-urlencoded": {
      "source": "iana",
      "compressible": true
    },
    "application/x-x509-ca-cert": {
      "source": "iana",
      "extensions": ["der","crt","pem"]
    },
    "application/x-x509-ca-ra-cert": {
      "source": "iana"
    },
    "application/x-x509-next-ca-cert": {
      "source": "iana"
    },
    "application/x-xfig": {
      "source": "apache",
      "extensions": ["fig"]
    },
    "application/x-xliff+xml": {
      "source": "apache",
      "compressible": true,
      "extensions": ["xlf"]
    },
    "application/x-xpinstall": {
      "source": "apache",
      "compressible": false,
      "extensions": ["xpi"]
    },
    "application/x-xz": {
      "source": "apache",
      "extensions": ["xz"]
    },
    "application/x-zmachine": {
      "source": "apache",
      "extensions": ["z1","z2","z3","z4","z5","z6","z7","z8"]
    },
    "application/x400-bp": {
      "source": "iana"
    },
    "application/xacml+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/xaml+xml": {
      "source": "apache",
      "compressible": true,
      "extensions": ["xaml"]
    },
    "application/xcap-att+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["xav"]
    },
    "application/xcap-caps+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["xca"]
    },
    "application/xcap-diff+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["xdf"]
    },
    "application/xcap-el+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["xel"]
    },
    "application/xcap-error+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["xer"]
    },
    "application/xcap-ns+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["xns"]
    },
    "application/xcon-conference-info+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/xcon-conference-info-diff+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/xenc+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["xenc"]
    },
    "application/xhtml+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["xhtml","xht"]
    },
    "application/xhtml-voice+xml": {
      "source": "apache",
      "compressible": true
    },
    "application/xliff+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["xlf"]
    },
    "application/xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["xml","xsl","xsd","rng"]
    },
    "application/xml-dtd": {
      "source": "iana",
      "compressible": true,
      "extensions": ["dtd"]
    },
    "application/xml-external-parsed-entity": {
      "source": "iana"
    },
    "application/xml-patch+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/xmpp+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/xop+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["xop"]
    },
    "application/xproc+xml": {
      "source": "apache",
      "compressible": true,
      "extensions": ["xpl"]
    },
    "application/xslt+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["xsl","xslt"]
    },
    "application/xspf+xml": {
      "source": "apache",
      "compressible": true,
      "extensions": ["xspf"]
    },
    "application/xv+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["mxml","xhvml","xvml","xvm"]
    },
    "application/yang": {
      "source": "iana",
      "extensions": ["yang"]
    },
    "application/yang-data+json": {
      "source": "iana",
      "compressible": true
    },
    "application/yang-data+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/yang-patch+json": {
      "source": "iana",
      "compressible": true
    },
    "application/yang-patch+xml": {
      "source": "iana",
      "compressible": true
    },
    "application/yin+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["yin"]
    },
    "application/zip": {
      "source": "iana",
      "compressible": false,
      "extensions": ["zip"]
    },
    "application/zlib": {
      "source": "iana"
    },
    "application/zstd": {
      "source": "iana"
    },
    "audio/1d-interleaved-parityfec": {
      "source": "iana"
    },
    "audio/32kadpcm": {
      "source": "iana"
    },
    "audio/3gpp": {
      "source": "iana",
      "compressible": false,
      "extensions": ["3gpp"]
    },
    "audio/3gpp2": {
      "source": "iana"
    },
    "audio/aac": {
      "source": "iana"
    },
    "audio/ac3": {
      "source": "iana"
    },
    "audio/adpcm": {
      "source": "apache",
      "extensions": ["adp"]
    },
    "audio/amr": {
      "source": "iana"
    },
    "audio/amr-wb": {
      "source": "iana"
    },
    "audio/amr-wb+": {
      "source": "iana"
    },
    "audio/aptx": {
      "source": "iana"
    },
    "audio/asc": {
      "source": "iana"
    },
    "audio/atrac-advanced-lossless": {
      "source": "iana"
    },
    "audio/atrac-x": {
      "source": "iana"
    },
    "audio/atrac3": {
      "source": "iana"
    },
    "audio/basic": {
      "source": "iana",
      "compressible": false,
      "extensions": ["au","snd"]
    },
    "audio/bv16": {
      "source": "iana"
    },
    "audio/bv32": {
      "source": "iana"
    },
    "audio/clearmode": {
      "source": "iana"
    },
    "audio/cn": {
      "source": "iana"
    },
    "audio/dat12": {
      "source": "iana"
    },
    "audio/dls": {
      "source": "iana"
    },
    "audio/dsr-es201108": {
      "source": "iana"
    },
    "audio/dsr-es202050": {
      "source": "iana"
    },
    "audio/dsr-es202211": {
      "source": "iana"
    },
    "audio/dsr-es202212": {
      "source": "iana"
    },
    "audio/dv": {
      "source": "iana"
    },
    "audio/dvi4": {
      "source": "iana"
    },
    "audio/eac3": {
      "source": "iana"
    },
    "audio/encaprtp": {
      "source": "iana"
    },
    "audio/evrc": {
      "source": "iana"
    },
    "audio/evrc-qcp": {
      "source": "iana"
    },
    "audio/evrc0": {
      "source": "iana"
    },
    "audio/evrc1": {
      "source": "iana"
    },
    "audio/evrcb": {
      "source": "iana"
    },
    "audio/evrcb0": {
      "source": "iana"
    },
    "audio/evrcb1": {
      "source": "iana"
    },
    "audio/evrcnw": {
      "source": "iana"
    },
    "audio/evrcnw0": {
      "source": "iana"
    },
    "audio/evrcnw1": {
      "source": "iana"
    },
    "audio/evrcwb": {
      "source": "iana"
    },
    "audio/evrcwb0": {
      "source": "iana"
    },
    "audio/evrcwb1": {
      "source": "iana"
    },
    "audio/evs": {
      "source": "iana"
    },
    "audio/flexfec": {
      "source": "iana"
    },
    "audio/fwdred": {
      "source": "iana"
    },
    "audio/g711-0": {
      "source": "iana"
    },
    "audio/g719": {
      "source": "iana"
    },
    "audio/g722": {
      "source": "iana"
    },
    "audio/g7221": {
      "source": "iana"
    },
    "audio/g723": {
      "source": "iana"
    },
    "audio/g726-16": {
      "source": "iana"
    },
    "audio/g726-24": {
      "source": "iana"
    },
    "audio/g726-32": {
      "source": "iana"
    },
    "audio/g726-40": {
      "source": "iana"
    },
    "audio/g728": {
      "source": "iana"
    },
    "audio/g729": {
      "source": "iana"
    },
    "audio/g7291": {
      "source": "iana"
    },
    "audio/g729d": {
      "source": "iana"
    },
    "audio/g729e": {
      "source": "iana"
    },
    "audio/gsm": {
      "source": "iana"
    },
    "audio/gsm-efr": {
      "source": "iana"
    },
    "audio/gsm-hr-08": {
      "source": "iana"
    },
    "audio/ilbc": {
      "source": "iana"
    },
    "audio/ip-mr_v2.5": {
      "source": "iana"
    },
    "audio/isac": {
      "source": "apache"
    },
    "audio/l16": {
      "source": "iana"
    },
    "audio/l20": {
      "source": "iana"
    },
    "audio/l24": {
      "source": "iana",
      "compressible": false
    },
    "audio/l8": {
      "source": "iana"
    },
    "audio/lpc": {
      "source": "iana"
    },
    "audio/melp": {
      "source": "iana"
    },
    "audio/melp1200": {
      "source": "iana"
    },
    "audio/melp2400": {
      "source": "iana"
    },
    "audio/melp600": {
      "source": "iana"
    },
    "audio/mhas": {
      "source": "iana"
    },
    "audio/midi": {
      "source": "apache",
      "extensions": ["mid","midi","kar","rmi"]
    },
    "audio/mobile-xmf": {
      "source": "iana",
      "extensions": ["mxmf"]
    },
    "audio/mp3": {
      "compressible": false,
      "extensions": ["mp3"]
    },
    "audio/mp4": {
      "source": "iana",
      "compressible": false,
      "extensions": ["m4a","mp4a"]
    },
    "audio/mp4a-latm": {
      "source": "iana"
    },
    "audio/mpa": {
      "source": "iana"
    },
    "audio/mpa-robust": {
      "source": "iana"
    },
    "audio/mpeg": {
      "source": "iana",
      "compressible": false,
      "extensions": ["mpga","mp2","mp2a","mp3","m2a","m3a"]
    },
    "audio/mpeg4-generic": {
      "source": "iana"
    },
    "audio/musepack": {
      "source": "apache"
    },
    "audio/ogg": {
      "source": "iana",
      "compressible": false,
      "extensions": ["oga","ogg","spx"]
    },
    "audio/opus": {
      "source": "iana"
    },
    "audio/parityfec": {
      "source": "iana"
    },
    "audio/pcma": {
      "source": "iana"
    },
    "audio/pcma-wb": {
      "source": "iana"
    },
    "audio/pcmu": {
      "source": "iana"
    },
    "audio/pcmu-wb": {
      "source": "iana"
    },
    "audio/prs.sid": {
      "source": "iana"
    },
    "audio/qcelp": {
      "source": "iana"
    },
    "audio/raptorfec": {
      "source": "iana"
    },
    "audio/red": {
      "source": "iana"
    },
    "audio/rtp-enc-aescm128": {
      "source": "iana"
    },
    "audio/rtp-midi": {
      "source": "iana"
    },
    "audio/rtploopback": {
      "source": "iana"
    },
    "audio/rtx": {
      "source": "iana"
    },
    "audio/s3m": {
      "source": "apache",
      "extensions": ["s3m"]
    },
    "audio/silk": {
      "source": "apache",
      "extensions": ["sil"]
    },
    "audio/smv": {
      "source": "iana"
    },
    "audio/smv-qcp": {
      "source": "iana"
    },
    "audio/smv0": {
      "source": "iana"
    },
    "audio/sofa": {
      "source": "iana"
    },
    "audio/sp-midi": {
      "source": "iana"
    },
    "audio/speex": {
      "source": "iana"
    },
    "audio/t140c": {
      "source": "iana"
    },
    "audio/t38": {
      "source": "iana"
    },
    "audio/telephone-event": {
      "source": "iana"
    },
    "audio/tetra_acelp": {
      "source": "iana"
    },
    "audio/tetra_acelp_bb": {
      "source": "iana"
    },
    "audio/tone": {
      "source": "iana"
    },
    "audio/tsvcis": {
      "source": "iana"
    },
    "audio/uemclip": {
      "source": "iana"
    },
    "audio/ulpfec": {
      "source": "iana"
    },
    "audio/usac": {
      "source": "iana"
    },
    "audio/vdvi": {
      "source": "iana"
    },
    "audio/vmr-wb": {
      "source": "iana"
    },
    "audio/vnd.3gpp.iufp": {
      "source": "iana"
    },
    "audio/vnd.4sb": {
      "source": "iana"
    },
    "audio/vnd.audiokoz": {
      "source": "iana"
    },
    "audio/vnd.celp": {
      "source": "iana"
    },
    "audio/vnd.cisco.nse": {
      "source": "iana"
    },
    "audio/vnd.cmles.radio-events": {
      "source": "iana"
    },
    "audio/vnd.cns.anp1": {
      "source": "iana"
    },
    "audio/vnd.cns.inf1": {
      "source": "iana"
    },
    "audio/vnd.dece.audio": {
      "source": "iana",
      "extensions": ["uva","uvva"]
    },
    "audio/vnd.digital-winds": {
      "source": "iana",
      "extensions": ["eol"]
    },
    "audio/vnd.dlna.adts": {
      "source": "iana"
    },
    "audio/vnd.dolby.heaac.1": {
      "source": "iana"
    },
    "audio/vnd.dolby.heaac.2": {
      "source": "iana"
    },
    "audio/vnd.dolby.mlp": {
      "source": "iana"
    },
    "audio/vnd.dolby.mps": {
      "source": "iana"
    },
    "audio/vnd.dolby.pl2": {
      "source": "iana"
    },
    "audio/vnd.dolby.pl2x": {
      "source": "iana"
    },
    "audio/vnd.dolby.pl2z": {
      "source": "iana"
    },
    "audio/vnd.dolby.pulse.1": {
      "source": "iana"
    },
    "audio/vnd.dra": {
      "source": "iana",
      "extensions": ["dra"]
    },
    "audio/vnd.dts": {
      "source": "iana",
      "extensions": ["dts"]
    },
    "audio/vnd.dts.hd": {
      "source": "iana",
      "extensions": ["dtshd"]
    },
    "audio/vnd.dts.uhd": {
      "source": "iana"
    },
    "audio/vnd.dvb.file": {
      "source": "iana"
    },
    "audio/vnd.everad.plj": {
      "source": "iana"
    },
    "audio/vnd.hns.audio": {
      "source": "iana"
    },
    "audio/vnd.lucent.voice": {
      "source": "iana",
      "extensions": ["lvp"]
    },
    "audio/vnd.ms-playready.media.pya": {
      "source": "iana",
      "extensions": ["pya"]
    },
    "audio/vnd.nokia.mobile-xmf": {
      "source": "iana"
    },
    "audio/vnd.nortel.vbk": {
      "source": "iana"
    },
    "audio/vnd.nuera.ecelp4800": {
      "source": "iana",
      "extensions": ["ecelp4800"]
    },
    "audio/vnd.nuera.ecelp7470": {
      "source": "iana",
      "extensions": ["ecelp7470"]
    },
    "audio/vnd.nuera.ecelp9600": {
      "source": "iana",
      "extensions": ["ecelp9600"]
    },
    "audio/vnd.octel.sbc": {
      "source": "iana"
    },
    "audio/vnd.presonus.multitrack": {
      "source": "iana"
    },
    "audio/vnd.qcelp": {
      "source": "iana"
    },
    "audio/vnd.rhetorex.32kadpcm": {
      "source": "iana"
    },
    "audio/vnd.rip": {
      "source": "iana",
      "extensions": ["rip"]
    },
    "audio/vnd.rn-realaudio": {
      "compressible": false
    },
    "audio/vnd.sealedmedia.softseal.mpeg": {
      "source": "iana"
    },
    "audio/vnd.vmx.cvsd": {
      "source": "iana"
    },
    "audio/vnd.wave": {
      "compressible": false
    },
    "audio/vorbis": {
      "source": "iana",
      "compressible": false
    },
    "audio/vorbis-config": {
      "source": "iana"
    },
    "audio/wav": {
      "compressible": false,
      "extensions": ["wav"]
    },
    "audio/wave": {
      "compressible": false,
      "extensions": ["wav"]
    },
    "audio/webm": {
      "source": "apache",
      "compressible": false,
      "extensions": ["weba"]
    },
    "audio/x-aac": {
      "source": "apache",
      "compressible": false,
      "extensions": ["aac"]
    },
    "audio/x-aiff": {
      "source": "apache",
      "extensions": ["aif","aiff","aifc"]
    },
    "audio/x-caf": {
      "source": "apache",
      "compressible": false,
      "extensions": ["caf"]
    },
    "audio/x-flac": {
      "source": "apache",
      "extensions": ["flac"]
    },
    "audio/x-m4a": {
      "source": "nginx",
      "extensions": ["m4a"]
    },
    "audio/x-matroska": {
      "source": "apache",
      "extensions": ["mka"]
    },
    "audio/x-mpegurl": {
      "source": "apache",
      "extensions": ["m3u"]
    },
    "audio/x-ms-wax": {
      "source": "apache",
      "extensions": ["wax"]
    },
    "audio/x-ms-wma": {
      "source": "apache",
      "extensions": ["wma"]
    },
    "audio/x-pn-realaudio": {
      "source": "apache",
      "extensions": ["ram","ra"]
    },
    "audio/x-pn-realaudio-plugin": {
      "source": "apache",
      "extensions": ["rmp"]
    },
    "audio/x-realaudio": {
      "source": "nginx",
      "extensions": ["ra"]
    },
    "audio/x-tta": {
      "source": "apache"
    },
    "audio/x-wav": {
      "source": "apache",
      "extensions": ["wav"]
    },
    "audio/xm": {
      "source": "apache",
      "extensions": ["xm"]
    },
    "chemical/x-cdx": {
      "source": "apache",
      "extensions": ["cdx"]
    },
    "chemical/x-cif": {
      "source": "apache",
      "extensions": ["cif"]
    },
    "chemical/x-cmdf": {
      "source": "apache",
      "extensions": ["cmdf"]
    },
    "chemical/x-cml": {
      "source": "apache",
      "extensions": ["cml"]
    },
    "chemical/x-csml": {
      "source": "apache",
      "extensions": ["csml"]
    },
    "chemical/x-pdb": {
      "source": "apache"
    },
    "chemical/x-xyz": {
      "source": "apache",
      "extensions": ["xyz"]
    },
    "font/collection": {
      "source": "iana",
      "extensions": ["ttc"]
    },
    "font/otf": {
      "source": "iana",
      "compressible": true,
      "extensions": ["otf"]
    },
    "font/sfnt": {
      "source": "iana"
    },
    "font/ttf": {
      "source": "iana",
      "compressible": true,
      "extensions": ["ttf"]
    },
    "font/woff": {
      "source": "iana",
      "extensions": ["woff"]
    },
    "font/woff2": {
      "source": "iana",
      "extensions": ["woff2"]
    },
    "image/aces": {
      "source": "iana",
      "extensions": ["exr"]
    },
    "image/apng": {
      "compressible": false,
      "extensions": ["apng"]
    },
    "image/avci": {
      "source": "iana"
    },
    "image/avcs": {
      "source": "iana"
    },
    "image/avif": {
      "compressible": false,
      "extensions": ["avif"]
    },
    "image/bmp": {
      "source": "iana",
      "compressible": true,
      "extensions": ["bmp"]
    },
    "image/cgm": {
      "source": "iana",
      "extensions": ["cgm"]
    },
    "image/dicom-rle": {
      "source": "iana",
      "extensions": ["drle"]
    },
    "image/emf": {
      "source": "iana",
      "extensions": ["emf"]
    },
    "image/fits": {
      "source": "iana",
      "extensions": ["fits"]
    },
    "image/g3fax": {
      "source": "iana",
      "extensions": ["g3"]
    },
    "image/gif": {
      "source": "iana",
      "compressible": false,
      "extensions": ["gif"]
    },
    "image/heic": {
      "source": "iana",
      "extensions": ["heic"]
    },
    "image/heic-sequence": {
      "source": "iana",
      "extensions": ["heics"]
    },
    "image/heif": {
      "source": "iana",
      "extensions": ["heif"]
    },
    "image/heif-sequence": {
      "source": "iana",
      "extensions": ["heifs"]
    },
    "image/hej2k": {
      "source": "iana",
      "extensions": ["hej2"]
    },
    "image/hsj2": {
      "source": "iana",
      "extensions": ["hsj2"]
    },
    "image/ief": {
      "source": "iana",
      "extensions": ["ief"]
    },
    "image/jls": {
      "source": "iana",
      "extensions": ["jls"]
    },
    "image/jp2": {
      "source": "iana",
      "compressible": false,
      "extensions": ["jp2","jpg2"]
    },
    "image/jpeg": {
      "source": "iana",
      "compressible": false,
      "extensions": ["jpeg","jpg","jpe"]
    },
    "image/jph": {
      "source": "iana",
      "extensions": ["jph"]
    },
    "image/jphc": {
      "source": "iana",
      "extensions": ["jhc"]
    },
    "image/jpm": {
      "source": "iana",
      "compressible": false,
      "extensions": ["jpm"]
    },
    "image/jpx": {
      "source": "iana",
      "compressible": false,
      "extensions": ["jpx","jpf"]
    },
    "image/jxr": {
      "source": "iana",
      "extensions": ["jxr"]
    },
    "image/jxra": {
      "source": "iana",
      "extensions": ["jxra"]
    },
    "image/jxrs": {
      "source": "iana",
      "extensions": ["jxrs"]
    },
    "image/jxs": {
      "source": "iana",
      "extensions": ["jxs"]
    },
    "image/jxsc": {
      "source": "iana",
      "extensions": ["jxsc"]
    },
    "image/jxsi": {
      "source": "iana",
      "extensions": ["jxsi"]
    },
    "image/jxss": {
      "source": "iana",
      "extensions": ["jxss"]
    },
    "image/ktx": {
      "source": "iana",
      "extensions": ["ktx"]
    },
    "image/ktx2": {
      "source": "iana",
      "extensions": ["ktx2"]
    },
    "image/naplps": {
      "source": "iana"
    },
    "image/pjpeg": {
      "compressible": false
    },
    "image/png": {
      "source": "iana",
      "compressible": false,
      "extensions": ["png"]
    },
    "image/prs.btif": {
      "source": "iana",
      "extensions": ["btif"]
    },
    "image/prs.pti": {
      "source": "iana",
      "extensions": ["pti"]
    },
    "image/pwg-raster": {
      "source": "iana"
    },
    "image/sgi": {
      "source": "apache",
      "extensions": ["sgi"]
    },
    "image/svg+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["svg","svgz"]
    },
    "image/t38": {
      "source": "iana",
      "extensions": ["t38"]
    },
    "image/tiff": {
      "source": "iana",
      "compressible": false,
      "extensions": ["tif","tiff"]
    },
    "image/tiff-fx": {
      "source": "iana",
      "extensions": ["tfx"]
    },
    "image/vnd.adobe.photoshop": {
      "source": "iana",
      "compressible": true,
      "extensions": ["psd"]
    },
    "image/vnd.airzip.accelerator.azv": {
      "source": "iana",
      "extensions": ["azv"]
    },
    "image/vnd.cns.inf2": {
      "source": "iana"
    },
    "image/vnd.dece.graphic": {
      "source": "iana",
      "extensions": ["uvi","uvvi","uvg","uvvg"]
    },
    "image/vnd.djvu": {
      "source": "iana",
      "extensions": ["djvu","djv"]
    },
    "image/vnd.dvb.subtitle": {
      "source": "iana",
      "extensions": ["sub"]
    },
    "image/vnd.dwg": {
      "source": "iana",
      "extensions": ["dwg"]
    },
    "image/vnd.dxf": {
      "source": "iana",
      "extensions": ["dxf"]
    },
    "image/vnd.fastbidsheet": {
      "source": "iana",
      "extensions": ["fbs"]
    },
    "image/vnd.fpx": {
      "source": "iana",
      "extensions": ["fpx"]
    },
    "image/vnd.fst": {
      "source": "iana",
      "extensions": ["fst"]
    },
    "image/vnd.fujixerox.edmics-mmr": {
      "source": "iana",
      "extensions": ["mmr"]
    },
    "image/vnd.fujixerox.edmics-rlc": {
      "source": "iana",
      "extensions": ["rlc"]
    },
    "image/vnd.globalgraphics.pgb": {
      "source": "iana"
    },
    "image/vnd.microsoft.icon": {
      "source": "iana",
      "extensions": ["ico"]
    },
    "image/vnd.mix": {
      "source": "iana"
    },
    "image/vnd.mozilla.apng": {
      "source": "iana"
    },
    "image/vnd.ms-dds": {
      "extensions": ["dds"]
    },
    "image/vnd.ms-modi": {
      "source": "iana",
      "extensions": ["mdi"]
    },
    "image/vnd.ms-photo": {
      "source": "apache",
      "extensions": ["wdp"]
    },
    "image/vnd.net-fpx": {
      "source": "iana",
      "extensions": ["npx"]
    },
    "image/vnd.pco.b16": {
      "source": "iana",
      "extensions": ["b16"]
    },
    "image/vnd.radiance": {
      "source": "iana"
    },
    "image/vnd.sealed.png": {
      "source": "iana"
    },
    "image/vnd.sealedmedia.softseal.gif": {
      "source": "iana"
    },
    "image/vnd.sealedmedia.softseal.jpg": {
      "source": "iana"
    },
    "image/vnd.svf": {
      "source": "iana"
    },
    "image/vnd.tencent.tap": {
      "source": "iana",
      "extensions": ["tap"]
    },
    "image/vnd.valve.source.texture": {
      "source": "iana",
      "extensions": ["vtf"]
    },
    "image/vnd.wap.wbmp": {
      "source": "iana",
      "extensions": ["wbmp"]
    },
    "image/vnd.xiff": {
      "source": "iana",
      "extensions": ["xif"]
    },
    "image/vnd.zbrush.pcx": {
      "source": "iana",
      "extensions": ["pcx"]
    },
    "image/webp": {
      "source": "apache",
      "extensions": ["webp"]
    },
    "image/wmf": {
      "source": "iana",
      "extensions": ["wmf"]
    },
    "image/x-3ds": {
      "source": "apache",
      "extensions": ["3ds"]
    },
    "image/x-cmu-raster": {
      "source": "apache",
      "extensions": ["ras"]
    },
    "image/x-cmx": {
      "source": "apache",
      "extensions": ["cmx"]
    },
    "image/x-freehand": {
      "source": "apache",
      "extensions": ["fh","fhc","fh4","fh5","fh7"]
    },
    "image/x-icon": {
      "source": "apache",
      "compressible": true,
      "extensions": ["ico"]
    },
    "image/x-jng": {
      "source": "nginx",
      "extensions": ["jng"]
    },
    "image/x-mrsid-image": {
      "source": "apache",
      "extensions": ["sid"]
    },
    "image/x-ms-bmp": {
      "source": "nginx",
      "compressible": true,
      "extensions": ["bmp"]
    },
    "image/x-pcx": {
      "source": "apache",
      "extensions": ["pcx"]
    },
    "image/x-pict": {
      "source": "apache",
      "extensions": ["pic","pct"]
    },
    "image/x-portable-anymap": {
      "source": "apache",
      "extensions": ["pnm"]
    },
    "image/x-portable-bitmap": {
      "source": "apache",
      "extensions": ["pbm"]
    },
    "image/x-portable-graymap": {
      "source": "apache",
      "extensions": ["pgm"]
    },
    "image/x-portable-pixmap": {
      "source": "apache",
      "extensions": ["ppm"]
    },
    "image/x-rgb": {
      "source": "apache",
      "extensions": ["rgb"]
    },
    "image/x-tga": {
      "source": "apache",
      "extensions": ["tga"]
    },
    "image/x-xbitmap": {
      "source": "apache",
      "extensions": ["xbm"]
    },
    "image/x-xcf": {
      "compressible": false
    },
    "image/x-xpixmap": {
      "source": "apache",
      "extensions": ["xpm"]
    },
    "image/x-xwindowdump": {
      "source": "apache",
      "extensions": ["xwd"]
    },
    "message/cpim": {
      "source": "iana"
    },
    "message/delivery-status": {
      "source": "iana"
    },
    "message/disposition-notification": {
      "source": "iana",
      "extensions": [
        "disposition-notification"
      ]
    },
    "message/external-body": {
      "source": "iana"
    },
    "message/feedback-report": {
      "source": "iana"
    },
    "message/global": {
      "source": "iana",
      "extensions": ["u8msg"]
    },
    "message/global-delivery-status": {
      "source": "iana",
      "extensions": ["u8dsn"]
    },
    "message/global-disposition-notification": {
      "source": "iana",
      "extensions": ["u8mdn"]
    },
    "message/global-headers": {
      "source": "iana",
      "extensions": ["u8hdr"]
    },
    "message/http": {
      "source": "iana",
      "compressible": false
    },
    "message/imdn+xml": {
      "source": "iana",
      "compressible": true
    },
    "message/news": {
      "source": "iana"
    },
    "message/partial": {
      "source": "iana",
      "compressible": false
    },
    "message/rfc822": {
      "source": "iana",
      "compressible": true,
      "extensions": ["eml","mime"]
    },
    "message/s-http": {
      "source": "iana"
    },
    "message/sip": {
      "source": "iana"
    },
    "message/sipfrag": {
      "source": "iana"
    },
    "message/tracking-status": {
      "source": "iana"
    },
    "message/vnd.si.simp": {
      "source": "iana"
    },
    "message/vnd.wfa.wsc": {
      "source": "iana",
      "extensions": ["wsc"]
    },
    "model/3mf": {
      "source": "iana",
      "extensions": ["3mf"]
    },
    "model/e57": {
      "source": "iana"
    },
    "model/gltf+json": {
      "source": "iana",
      "compressible": true,
      "extensions": ["gltf"]
    },
    "model/gltf-binary": {
      "source": "iana",
      "compressible": true,
      "extensions": ["glb"]
    },
    "model/iges": {
      "source": "iana",
      "compressible": false,
      "extensions": ["igs","iges"]
    },
    "model/mesh": {
      "source": "iana",
      "compressible": false,
      "extensions": ["msh","mesh","silo"]
    },
    "model/mtl": {
      "source": "iana",
      "extensions": ["mtl"]
    },
    "model/obj": {
      "source": "iana",
      "extensions": ["obj"]
    },
    "model/stl": {
      "source": "iana",
      "extensions": ["stl"]
    },
    "model/vnd.collada+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["dae"]
    },
    "model/vnd.dwf": {
      "source": "iana",
      "extensions": ["dwf"]
    },
    "model/vnd.flatland.3dml": {
      "source": "iana"
    },
    "model/vnd.gdl": {
      "source": "iana",
      "extensions": ["gdl"]
    },
    "model/vnd.gs-gdl": {
      "source": "apache"
    },
    "model/vnd.gs.gdl": {
      "source": "iana"
    },
    "model/vnd.gtw": {
      "source": "iana",
      "extensions": ["gtw"]
    },
    "model/vnd.moml+xml": {
      "source": "iana",
      "compressible": true
    },
    "model/vnd.mts": {
      "source": "iana",
      "extensions": ["mts"]
    },
    "model/vnd.opengex": {
      "source": "iana",
      "extensions": ["ogex"]
    },
    "model/vnd.parasolid.transmit.binary": {
      "source": "iana",
      "extensions": ["x_b"]
    },
    "model/vnd.parasolid.transmit.text": {
      "source": "iana",
      "extensions": ["x_t"]
    },
    "model/vnd.rosette.annotated-data-model": {
      "source": "iana"
    },
    "model/vnd.usdz+zip": {
      "source": "iana",
      "compressible": false,
      "extensions": ["usdz"]
    },
    "model/vnd.valve.source.compiled-map": {
      "source": "iana",
      "extensions": ["bsp"]
    },
    "model/vnd.vtu": {
      "source": "iana",
      "extensions": ["vtu"]
    },
    "model/vrml": {
      "source": "iana",
      "compressible": false,
      "extensions": ["wrl","vrml"]
    },
    "model/x3d+binary": {
      "source": "apache",
      "compressible": false,
      "extensions": ["x3db","x3dbz"]
    },
    "model/x3d+fastinfoset": {
      "source": "iana",
      "extensions": ["x3db"]
    },
    "model/x3d+vrml": {
      "source": "apache",
      "compressible": false,
      "extensions": ["x3dv","x3dvz"]
    },
    "model/x3d+xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["x3d","x3dz"]
    },
    "model/x3d-vrml": {
      "source": "iana",
      "extensions": ["x3dv"]
    },
    "multipart/alternative": {
      "source": "iana",
      "compressible": false
    },
    "multipart/appledouble": {
      "source": "iana"
    },
    "multipart/byteranges": {
      "source": "iana"
    },
    "multipart/digest": {
      "source": "iana"
    },
    "multipart/encrypted": {
      "source": "iana",
      "compressible": false
    },
    "multipart/form-data": {
      "source": "iana",
      "compressible": false
    },
    "multipart/header-set": {
      "source": "iana"
    },
    "multipart/mixed": {
      "source": "iana"
    },
    "multipart/multilingual": {
      "source": "iana"
    },
    "multipart/parallel": {
      "source": "iana"
    },
    "multipart/related": {
      "source": "iana",
      "compressible": false
    },
    "multipart/report": {
      "source": "iana"
    },
    "multipart/signed": {
      "source": "iana",
      "compressible": false
    },
    "multipart/vnd.bint.med-plus": {
      "source": "iana"
    },
    "multipart/voice-message": {
      "source": "iana"
    },
    "multipart/x-mixed-replace": {
      "source": "iana"
    },
    "text/1d-interleaved-parityfec": {
      "source": "iana"
    },
    "text/cache-manifest": {
      "source": "iana",
      "compressible": true,
      "extensions": ["appcache","manifest"]
    },
    "text/calendar": {
      "source": "iana",
      "extensions": ["ics","ifb"]
    },
    "text/calender": {
      "compressible": true
    },
    "text/cmd": {
      "compressible": true
    },
    "text/coffeescript": {
      "extensions": ["coffee","litcoffee"]
    },
    "text/css": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true,
      "extensions": ["css"]
    },
    "text/csv": {
      "source": "iana",
      "compressible": true,
      "extensions": ["csv"]
    },
    "text/csv-schema": {
      "source": "iana"
    },
    "text/directory": {
      "source": "iana"
    },
    "text/dns": {
      "source": "iana"
    },
    "text/ecmascript": {
      "source": "iana"
    },
    "text/encaprtp": {
      "source": "iana"
    },
    "text/enriched": {
      "source": "iana"
    },
    "text/flexfec": {
      "source": "iana"
    },
    "text/fwdred": {
      "source": "iana"
    },
    "text/gff3": {
      "source": "iana"
    },
    "text/grammar-ref-list": {
      "source": "iana"
    },
    "text/html": {
      "source": "iana",
      "compressible": true,
      "extensions": ["html","htm","shtml"]
    },
    "text/jade": {
      "extensions": ["jade"]
    },
    "text/javascript": {
      "source": "iana",
      "compressible": true
    },
    "text/jcr-cnd": {
      "source": "iana"
    },
    "text/jsx": {
      "compressible": true,
      "extensions": ["jsx"]
    },
    "text/less": {
      "compressible": true,
      "extensions": ["less"]
    },
    "text/markdown": {
      "source": "iana",
      "compressible": true,
      "extensions": ["markdown","md"]
    },
    "text/mathml": {
      "source": "nginx",
      "extensions": ["mml"]
    },
    "text/mdx": {
      "compressible": true,
      "extensions": ["mdx"]
    },
    "text/mizar": {
      "source": "iana"
    },
    "text/n3": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true,
      "extensions": ["n3"]
    },
    "text/parameters": {
      "source": "iana",
      "charset": "UTF-8"
    },
    "text/parityfec": {
      "source": "iana"
    },
    "text/plain": {
      "source": "iana",
      "compressible": true,
      "extensions": ["txt","text","conf","def","list","log","in","ini"]
    },
    "text/provenance-notation": {
      "source": "iana",
      "charset": "UTF-8"
    },
    "text/prs.fallenstein.rst": {
      "source": "iana"
    },
    "text/prs.lines.tag": {
      "source": "iana",
      "extensions": ["dsc"]
    },
    "text/prs.prop.logic": {
      "source": "iana"
    },
    "text/raptorfec": {
      "source": "iana"
    },
    "text/red": {
      "source": "iana"
    },
    "text/rfc822-headers": {
      "source": "iana"
    },
    "text/richtext": {
      "source": "iana",
      "compressible": true,
      "extensions": ["rtx"]
    },
    "text/rtf": {
      "source": "iana",
      "compressible": true,
      "extensions": ["rtf"]
    },
    "text/rtp-enc-aescm128": {
      "source": "iana"
    },
    "text/rtploopback": {
      "source": "iana"
    },
    "text/rtx": {
      "source": "iana"
    },
    "text/sgml": {
      "source": "iana",
      "extensions": ["sgml","sgm"]
    },
    "text/shaclc": {
      "source": "iana"
    },
    "text/shex": {
      "extensions": ["shex"]
    },
    "text/slim": {
      "extensions": ["slim","slm"]
    },
    "text/spdx": {
      "source": "iana",
      "extensions": ["spdx"]
    },
    "text/strings": {
      "source": "iana"
    },
    "text/stylus": {
      "extensions": ["stylus","styl"]
    },
    "text/t140": {
      "source": "iana"
    },
    "text/tab-separated-values": {
      "source": "iana",
      "compressible": true,
      "extensions": ["tsv"]
    },
    "text/troff": {
      "source": "iana",
      "extensions": ["t","tr","roff","man","me","ms"]
    },
    "text/turtle": {
      "source": "iana",
      "charset": "UTF-8",
      "extensions": ["ttl"]
    },
    "text/ulpfec": {
      "source": "iana"
    },
    "text/uri-list": {
      "source": "iana",
      "compressible": true,
      "extensions": ["uri","uris","urls"]
    },
    "text/vcard": {
      "source": "iana",
      "compressible": true,
      "extensions": ["vcard"]
    },
    "text/vnd.a": {
      "source": "iana"
    },
    "text/vnd.abc": {
      "source": "iana"
    },
    "text/vnd.ascii-art": {
      "source": "iana"
    },
    "text/vnd.curl": {
      "source": "iana",
      "extensions": ["curl"]
    },
    "text/vnd.curl.dcurl": {
      "source": "apache",
      "extensions": ["dcurl"]
    },
    "text/vnd.curl.mcurl": {
      "source": "apache",
      "extensions": ["mcurl"]
    },
    "text/vnd.curl.scurl": {
      "source": "apache",
      "extensions": ["scurl"]
    },
    "text/vnd.debian.copyright": {
      "source": "iana",
      "charset": "UTF-8"
    },
    "text/vnd.dmclientscript": {
      "source": "iana"
    },
    "text/vnd.dvb.subtitle": {
      "source": "iana",
      "extensions": ["sub"]
    },
    "text/vnd.esmertec.theme-descriptor": {
      "source": "iana",
      "charset": "UTF-8"
    },
    "text/vnd.ficlab.flt": {
      "source": "iana"
    },
    "text/vnd.fly": {
      "source": "iana",
      "extensions": ["fly"]
    },
    "text/vnd.fmi.flexstor": {
      "source": "iana",
      "extensions": ["flx"]
    },
    "text/vnd.gml": {
      "source": "iana"
    },
    "text/vnd.graphviz": {
      "source": "iana",
      "extensions": ["gv"]
    },
    "text/vnd.hans": {
      "source": "iana"
    },
    "text/vnd.hgl": {
      "source": "iana"
    },
    "text/vnd.in3d.3dml": {
      "source": "iana",
      "extensions": ["3dml"]
    },
    "text/vnd.in3d.spot": {
      "source": "iana",
      "extensions": ["spot"]
    },
    "text/vnd.iptc.newsml": {
      "source": "iana"
    },
    "text/vnd.iptc.nitf": {
      "source": "iana"
    },
    "text/vnd.latex-z": {
      "source": "iana"
    },
    "text/vnd.motorola.reflex": {
      "source": "iana"
    },
    "text/vnd.ms-mediapackage": {
      "source": "iana"
    },
    "text/vnd.net2phone.commcenter.command": {
      "source": "iana"
    },
    "text/vnd.radisys.msml-basic-layout": {
      "source": "iana"
    },
    "text/vnd.senx.warpscript": {
      "source": "iana"
    },
    "text/vnd.si.uricatalogue": {
      "source": "iana"
    },
    "text/vnd.sosi": {
      "source": "iana"
    },
    "text/vnd.sun.j2me.app-descriptor": {
      "source": "iana",
      "charset": "UTF-8",
      "extensions": ["jad"]
    },
    "text/vnd.trolltech.linguist": {
      "source": "iana",
      "charset": "UTF-8"
    },
    "text/vnd.wap.si": {
      "source": "iana"
    },
    "text/vnd.wap.sl": {
      "source": "iana"
    },
    "text/vnd.wap.wml": {
      "source": "iana",
      "extensions": ["wml"]
    },
    "text/vnd.wap.wmlscript": {
      "source": "iana",
      "extensions": ["wmls"]
    },
    "text/vtt": {
      "source": "iana",
      "charset": "UTF-8",
      "compressible": true,
      "extensions": ["vtt"]
    },
    "text/x-asm": {
      "source": "apache",
      "extensions": ["s","asm"]
    },
    "text/x-c": {
      "source": "apache",
      "extensions": ["c","cc","cxx","cpp","h","hh","dic"]
    },
    "text/x-component": {
      "source": "nginx",
      "extensions": ["htc"]
    },
    "text/x-fortran": {
      "source": "apache",
      "extensions": ["f","for","f77","f90"]
    },
    "text/x-gwt-rpc": {
      "compressible": true
    },
    "text/x-handlebars-template": {
      "extensions": ["hbs"]
    },
    "text/x-java-source": {
      "source": "apache",
      "extensions": ["java"]
    },
    "text/x-jquery-tmpl": {
      "compressible": true
    },
    "text/x-lua": {
      "extensions": ["lua"]
    },
    "text/x-markdown": {
      "compressible": true,
      "extensions": ["mkd"]
    },
    "text/x-nfo": {
      "source": "apache",
      "extensions": ["nfo"]
    },
    "text/x-opml": {
      "source": "apache",
      "extensions": ["opml"]
    },
    "text/x-org": {
      "compressible": true,
      "extensions": ["org"]
    },
    "text/x-pascal": {
      "source": "apache",
      "extensions": ["p","pas"]
    },
    "text/x-processing": {
      "compressible": true,
      "extensions": ["pde"]
    },
    "text/x-sass": {
      "extensions": ["sass"]
    },
    "text/x-scss": {
      "extensions": ["scss"]
    },
    "text/x-setext": {
      "source": "apache",
      "extensions": ["etx"]
    },
    "text/x-sfv": {
      "source": "apache",
      "extensions": ["sfv"]
    },
    "text/x-suse-ymp": {
      "compressible": true,
      "extensions": ["ymp"]
    },
    "text/x-uuencode": {
      "source": "apache",
      "extensions": ["uu"]
    },
    "text/x-vcalendar": {
      "source": "apache",
      "extensions": ["vcs"]
    },
    "text/x-vcard": {
      "source": "apache",
      "extensions": ["vcf"]
    },
    "text/xml": {
      "source": "iana",
      "compressible": true,
      "extensions": ["xml"]
    },
    "text/xml-external-parsed-entity": {
      "source": "iana"
    },
    "text/yaml": {
      "extensions": ["yaml","yml"]
    },
    "video/1d-interleaved-parityfec": {
      "source": "iana"
    },
    "video/3gpp": {
      "source": "iana",
      "extensions": ["3gp","3gpp"]
    },
    "video/3gpp-tt": {
      "source": "iana"
    },
    "video/3gpp2": {
      "source": "iana",
      "extensions": ["3g2"]
    },
    "video/bmpeg": {
      "source": "iana"
    },
    "video/bt656": {
      "source": "iana"
    },
    "video/celb": {
      "source": "iana"
    },
    "video/dv": {
      "source": "iana"
    },
    "video/encaprtp": {
      "source": "iana"
    },
    "video/flexfec": {
      "source": "iana"
    },
    "video/h261": {
      "source": "iana",
      "extensions": ["h261"]
    },
    "video/h263": {
      "source": "iana",
      "extensions": ["h263"]
    },
    "video/h263-1998": {
      "source": "iana"
    },
    "video/h263-2000": {
      "source": "iana"
    },
    "video/h264": {
      "source": "iana",
      "extensions": ["h264"]
    },
    "video/h264-rcdo": {
      "source": "iana"
    },
    "video/h264-svc": {
      "source": "iana"
    },
    "video/h265": {
      "source": "iana"
    },
    "video/iso.segment": {
      "source": "iana"
    },
    "video/jpeg": {
      "source": "iana",
      "extensions": ["jpgv"]
    },
    "video/jpeg2000": {
      "source": "iana"
    },
    "video/jpm": {
      "source": "apache",
      "extensions": ["jpm","jpgm"]
    },
    "video/mj2": {
      "source": "iana",
      "extensions": ["mj2","mjp2"]
    },
    "video/mp1s": {
      "source": "iana"
    },
    "video/mp2p": {
      "source": "iana"
    },
    "video/mp2t": {
      "source": "iana",
      "extensions": ["ts"]
    },
    "video/mp4": {
      "source": "iana",
      "compressible": false,
      "extensions": ["mp4","mp4v","mpg4"]
    },
    "video/mp4v-es": {
      "source": "iana"
    },
    "video/mpeg": {
      "source": "iana",
      "compressible": false,
      "extensions": ["mpeg","mpg","mpe","m1v","m2v"]
    },
    "video/mpeg4-generic": {
      "source": "iana"
    },
    "video/mpv": {
      "source": "iana"
    },
    "video/nv": {
      "source": "iana"
    },
    "video/ogg": {
      "source": "iana",
      "compressible": false,
      "extensions": ["ogv"]
    },
    "video/parityfec": {
      "source": "iana"
    },
    "video/pointer": {
      "source": "iana"
    },
    "video/quicktime": {
      "source": "iana",
      "compressible": false,
      "extensions": ["qt","mov"]
    },
    "video/raptorfec": {
      "source": "iana"
    },
    "video/raw": {
      "source": "iana"
    },
    "video/rtp-enc-aescm128": {
      "source": "iana"
    },
    "video/rtploopback": {
      "source": "iana"
    },
    "video/rtx": {
      "source": "iana"
    },
    "video/smpte291": {
      "source": "iana"
    },
    "video/smpte292m": {
      "source": "iana"
    },
    "video/ulpfec": {
      "source": "iana"
    },
    "video/vc1": {
      "source": "iana"
    },
    "video/vc2": {
      "source": "iana"
    },
    "video/vnd.cctv": {
      "source": "iana"
    },
    "video/vnd.dece.hd": {
      "source": "iana",
      "extensions": ["uvh","uvvh"]
    },
    "video/vnd.dece.mobile": {
      "source": "iana",
      "extensions": ["uvm","uvvm"]
    },
    "video/vnd.dece.mp4": {
      "source": "iana"
    },
    "video/vnd.dece.pd": {
      "source": "iana",
      "extensions": ["uvp","uvvp"]
    },
    "video/vnd.dece.sd": {
      "source": "iana",
      "extensions": ["uvs","uvvs"]
    },
    "video/vnd.dece.video": {
      "source": "iana",
      "extensions": ["uvv","uvvv"]
    },
    "video/vnd.directv.mpeg": {
      "source": "iana"
    },
    "video/vnd.directv.mpeg-tts": {
      "source": "iana"
    },
    "video/vnd.dlna.mpeg-tts": {
      "source": "iana"
    },
    "video/vnd.dvb.file": {
      "source": "iana",
      "extensions": ["dvb"]
    },
    "video/vnd.fvt": {
      "source": "iana",
      "extensions": ["fvt"]
    },
    "video/vnd.hns.video": {
      "source": "iana"
    },
    "video/vnd.iptvforum.1dparityfec-1010": {
      "source": "iana"
    },
    "video/vnd.iptvforum.1dparityfec-2005": {
      "source": "iana"
    },
    "video/vnd.iptvforum.2dparityfec-1010": {
      "source": "iana"
    },
    "video/vnd.iptvforum.2dparityfec-2005": {
      "source": "iana"
    },
    "video/vnd.iptvforum.ttsavc": {
      "source": "iana"
    },
    "video/vnd.iptvforum.ttsmpeg2": {
      "source": "iana"
    },
    "video/vnd.motorola.video": {
      "source": "iana"
    },
    "video/vnd.motorola.videop": {
      "source": "iana"
    },
    "video/vnd.mpegurl": {
      "source": "iana",
      "extensions": ["mxu","m4u"]
    },
    "video/vnd.ms-playready.media.pyv": {
      "source": "iana",
      "extensions": ["pyv"]
    },
    "video/vnd.nokia.interleaved-multimedia": {
      "source": "iana"
    },
    "video/vnd.nokia.mp4vr": {
      "source": "iana"
    },
    "video/vnd.nokia.videovoip": {
      "source": "iana"
    },
    "video/vnd.objectvideo": {
      "source": "iana"
    },
    "video/vnd.radgamettools.bink": {
      "source": "iana"
    },
    "video/vnd.radgamettools.smacker": {
      "source": "iana"
    },
    "video/vnd.sealed.mpeg1": {
      "source": "iana"
    },
    "video/vnd.sealed.mpeg4": {
      "source": "iana"
    },
    "video/vnd.sealed.swf": {
      "source": "iana"
    },
    "video/vnd.sealedmedia.softseal.mov": {
      "source": "iana"
    },
    "video/vnd.uvvu.mp4": {
      "source": "iana",
      "extensions": ["uvu","uvvu"]
    },
    "video/vnd.vivo": {
      "source": "iana",
      "extensions": ["viv"]
    },
    "video/vnd.youtube.yt": {
      "source": "iana"
    },
    "video/vp8": {
      "source": "iana"
    },
    "video/webm": {
      "source": "apache",
      "compressible": false,
      "extensions": ["webm"]
    },
    "video/x-f4v": {
      "source": "apache",
      "extensions": ["f4v"]
    },
    "video/x-fli": {
      "source": "apache",
      "extensions": ["fli"]
    },
    "video/x-flv": {
      "source": "apache",
      "compressible": false,
      "extensions": ["flv"]
    },
    "video/x-m4v": {
      "source": "apache",
      "extensions": ["m4v"]
    },
    "video/x-matroska": {
      "source": "apache",
      "compressible": false,
      "extensions": ["mkv","mk3d","mks"]
    },
    "video/x-mng": {
      "source": "apache",
      "extensions": ["mng"]
    },
    "video/x-ms-asf": {
      "source": "apache",
      "extensions": ["asf","asx"]
    },
    "video/x-ms-vob": {
      "source": "apache",
      "extensions": ["vob"]
    },
    "video/x-ms-wm": {
      "source": "apache",
      "extensions": ["wm"]
    },
    "video/x-ms-wmv": {
      "source": "apache",
      "compressible": false,
      "extensions": ["wmv"]
    },
    "video/x-ms-wmx": {
      "source": "apache",
      "extensions": ["wmx"]
    },
    "video/x-ms-wvx": {
      "source": "apache",
      "extensions": ["wvx"]
    },
    "video/x-msvideo": {
      "source": "apache",
      "extensions": ["avi"]
    },
    "video/x-sgi-movie": {
      "source": "apache",
      "extensions": ["movie"]
    },
    "video/x-smv": {
      "source": "apache",
      "extensions": ["smv"]
    },
    "x-conference/x-cooltalk": {
      "source": "apache",
      "extensions": ["ice"]
    },
    "x-shader/x-fragment": {
      "compressible": true
    },
    "x-shader/x-vertex": {
      "compressible": true
    }
  }
  
  },{}],73:[function(require,module,exports){
  /*!
   * mime-db
   * Copyright(c) 2014 Jonathan Ong
   * MIT Licensed
   */
  
  /**
   * Module exports.
   */
  
  module.exports = require('./db.json')
  
  },{"./db.json":72}],74:[function(require,module,exports){
  /*!
   * mime-types
   * Copyright(c) 2014 Jonathan Ong
   * Copyright(c) 2015 Douglas Christopher Wilson
   * MIT Licensed
   */
  
  'use strict'
  
  /**
   * Module dependencies.
   * @private
   */
  
  var db = require('mime-db')
  var extname = require('path').extname
  
  /**
   * Module variables.
   * @private
   */
  
  var EXTRACT_TYPE_REGEXP = /^\s*([^;\s]*)(?:;|\s|$)/
  var TEXT_TYPE_REGEXP = /^text\//i
  
  /**
   * Module exports.
   * @public
   */
  
  exports.charset = charset
  exports.charsets = { lookup: charset }
  exports.contentType = contentType
  exports.extension = extension
  exports.extensions = Object.create(null)
  exports.lookup = lookup
  exports.types = Object.create(null)
  
  // Populate the extensions/types maps
  populateMaps(exports.extensions, exports.types)
  
  /**
   * Get the default charset for a MIME type.
   *
   * @param {string} type
   * @return {boolean|string}
   */
  
  function charset (type) {
    if (!type || typeof type !== 'string') {
      return false
    }
  
    // TODO: use media-typer
    var match = EXTRACT_TYPE_REGEXP.exec(type)
    var mime = match && db[match[1].toLowerCase()]
  
    if (mime && mime.charset) {
      return mime.charset
    }
  
    // default text/* to utf-8
    if (match && TEXT_TYPE_REGEXP.test(match[1])) {
      return 'UTF-8'
    }
  
    return false
  }
  
  /**
   * Create a full Content-Type header given a MIME type or extension.
   *
   * @param {string} str
   * @return {boolean|string}
   */
  
  function contentType (str) {
    // TODO: should this even be in this module?
    if (!str || typeof str !== 'string') {
      return false
    }
  
    var mime = str.indexOf('/') === -1
      ? exports.lookup(str)
      : str
  
    if (!mime) {
      return false
    }
  
    // TODO: use content-type or other module
    if (mime.indexOf('charset') === -1) {
      var charset = exports.charset(mime)
      if (charset) mime += '; charset=' + charset.toLowerCase()
    }
  
    return mime
  }
  
  /**
   * Get the default extension for a MIME type.
   *
   * @param {string} type
   * @return {boolean|string}
   */
  
  function extension (type) {
    if (!type || typeof type !== 'string') {
      return false
    }
  
    // TODO: use media-typer
    var match = EXTRACT_TYPE_REGEXP.exec(type)
  
    // get extensions
    var exts = match && exports.extensions[match[1].toLowerCase()]
  
    if (!exts || !exts.length) {
      return false
    }
  
    return exts[0]
  }
  
  /**
   * Lookup the MIME type for a file path/extension.
   *
   * @param {string} path
   * @return {boolean|string}
   */
  
  function lookup (path) {
    if (!path || typeof path !== 'string') {
      return false
    }
  
    // get the extension ("ext" or ".ext" or full path)
    var extension = extname('x.' + path)
      .toLowerCase()
      .substr(1)
  
    if (!extension) {
      return false
    }
  
    return exports.types[extension] || false
  }
  
  /**
   * Populate the extensions and types maps.
   * @private
   */
  
  function populateMaps (extensions, types) {
    // source preference (least -> most)
    var preference = ['nginx', 'apache', undefined, 'iana']
  
    Object.keys(db).forEach(function forEachMimeType (type) {
      var mime = db[type]
      var exts = mime.extensions
  
      if (!exts || !exts.length) {
        return
      }
  
      // mime -> extensions
      extensions[type] = exts
  
      // extension -> mime
      for (var i = 0; i < exts.length; i++) {
        var extension = exts[i]
  
        if (types[extension]) {
          var from = preference.indexOf(db[types[extension]].source)
          var to = preference.indexOf(mime.source)
  
          if (types[extension] !== 'application/octet-stream' &&
            (from > to || (from === to && types[extension].substr(0, 12) === 'application/'))) {
            // skip the remapping
            continue
          }
        }
  
        // set the extension -> mime
        types[extension] = type
      }
    })
  }
  
  },{"mime-db":73,"path":10}],75:[function(require,module,exports){
  'use strict';
  
  /**
   * @param typeMap [Object] Map of MIME type -> Array[extensions]
   * @param ...
   */
  function Mime() {
    this._types = Object.create(null);
    this._extensions = Object.create(null);
  
    for (let i = 0; i < arguments.length; i++) {
      this.define(arguments[i]);
    }
  
    this.define = this.define.bind(this);
    this.getType = this.getType.bind(this);
    this.getExtension = this.getExtension.bind(this);
  }
  
  /**
   * Define mimetype -> extension mappings.  Each key is a mime-type that maps
   * to an array of extensions associated with the type.  The first extension is
   * used as the default extension for the type.
   *
   * e.g. mime.define({'audio/ogg', ['oga', 'ogg', 'spx']});
   *
   * If a type declares an extension that has already been defined, an error will
   * be thrown.  To suppress this error and force the extension to be associated
   * with the new type, pass `force`=true.  Alternatively, you may prefix the
   * extension with "*" to map the type to extension, without mapping the
   * extension to the type.
   *
   * e.g. mime.define({'audio/wav', ['wav']}, {'audio/x-wav', ['*wav']});
   *
   *
   * @param map (Object) type definitions
   * @param force (Boolean) if true, force overriding of existing definitions
   */
  Mime.prototype.define = function(typeMap, force) {
    for (let type in typeMap) {
      let extensions = typeMap[type].map(function(t) {
        return t.toLowerCase();
      });
      type = type.toLowerCase();
  
      for (let i = 0; i < extensions.length; i++) {
        const ext = extensions[i];
  
        // '*' prefix = not the preferred type for this extension.  So fixup the
        // extension, and skip it.
        if (ext[0] === '*') {
          continue;
        }
  
        if (!force && (ext in this._types)) {
          throw new Error(
            'Attempt to change mapping for "' + ext +
            '" extension from "' + this._types[ext] + '" to "' + type +
            '". Pass `force=true` to allow this, otherwise remove "' + ext +
            '" from the list of extensions for "' + type + '".'
          );
        }
  
        this._types[ext] = type;
      }
  
      // Use first extension as default
      if (force || !this._extensions[type]) {
        const ext = extensions[0];
        this._extensions[type] = (ext[0] !== '*') ? ext : ext.substr(1);
      }
    }
  };
  
  /**
   * Lookup a mime type based on extension
   */
  Mime.prototype.getType = function(path) {
    path = String(path);
    let last = path.replace(/^.*[/\\]/, '').toLowerCase();
    let ext = last.replace(/^.*\./, '').toLowerCase();
  
    let hasPath = last.length < path.length;
    let hasDot = ext.length < last.length - 1;
  
    return (hasDot || !hasPath) && this._types[ext] || null;
  };
  
  /**
   * Return file extension associated with a mime type
   */
  Mime.prototype.getExtension = function(type) {
    type = /^\s*([^;\s]*)/.test(type) && RegExp.$1;
    return type && this._extensions[type.toLowerCase()] || null;
  };
  
  module.exports = Mime;
  
  },{}],76:[function(require,module,exports){
  'use strict';
  
  let Mime = require('./Mime');
  module.exports = new Mime(require('./types/standard'), require('./types/other'));
  
  },{"./Mime":75,"./types/other":77,"./types/standard":78}],77:[function(require,module,exports){
  module.exports = {"application/prs.cww":["cww"],"application/vnd.1000minds.decision-model+xml":["1km"],"application/vnd.3gpp.pic-bw-large":["plb"],"application/vnd.3gpp.pic-bw-small":["psb"],"application/vnd.3gpp.pic-bw-var":["pvb"],"application/vnd.3gpp2.tcap":["tcap"],"application/vnd.3m.post-it-notes":["pwn"],"application/vnd.accpac.simply.aso":["aso"],"application/vnd.accpac.simply.imp":["imp"],"application/vnd.acucobol":["acu"],"application/vnd.acucorp":["atc","acutc"],"application/vnd.adobe.air-application-installer-package+zip":["air"],"application/vnd.adobe.formscentral.fcdt":["fcdt"],"application/vnd.adobe.fxp":["fxp","fxpl"],"application/vnd.adobe.xdp+xml":["xdp"],"application/vnd.adobe.xfdf":["xfdf"],"application/vnd.ahead.space":["ahead"],"application/vnd.airzip.filesecure.azf":["azf"],"application/vnd.airzip.filesecure.azs":["azs"],"application/vnd.amazon.ebook":["azw"],"application/vnd.americandynamics.acc":["acc"],"application/vnd.amiga.ami":["ami"],"application/vnd.android.package-archive":["apk"],"application/vnd.anser-web-certificate-issue-initiation":["cii"],"application/vnd.anser-web-funds-transfer-initiation":["fti"],"application/vnd.antix.game-component":["atx"],"application/vnd.apple.installer+xml":["mpkg"],"application/vnd.apple.keynote":["key"],"application/vnd.apple.mpegurl":["m3u8"],"application/vnd.apple.numbers":["numbers"],"application/vnd.apple.pages":["pages"],"application/vnd.apple.pkpass":["pkpass"],"application/vnd.aristanetworks.swi":["swi"],"application/vnd.astraea-software.iota":["iota"],"application/vnd.audiograph":["aep"],"application/vnd.balsamiq.bmml+xml":["bmml"],"application/vnd.blueice.multipass":["mpm"],"application/vnd.bmi":["bmi"],"application/vnd.businessobjects":["rep"],"application/vnd.chemdraw+xml":["cdxml"],"application/vnd.chipnuts.karaoke-mmd":["mmd"],"application/vnd.cinderella":["cdy"],"application/vnd.citationstyles.style+xml":["csl"],"application/vnd.claymore":["cla"],"application/vnd.cloanto.rp9":["rp9"],"application/vnd.clonk.c4group":["c4g","c4d","c4f","c4p","c4u"],"application/vnd.cluetrust.cartomobile-config":["c11amc"],"application/vnd.cluetrust.cartomobile-config-pkg":["c11amz"],"application/vnd.commonspace":["csp"],"application/vnd.contact.cmsg":["cdbcmsg"],"application/vnd.cosmocaller":["cmc"],"application/vnd.crick.clicker":["clkx"],"application/vnd.crick.clicker.keyboard":["clkk"],"application/vnd.crick.clicker.palette":["clkp"],"application/vnd.crick.clicker.template":["clkt"],"application/vnd.crick.clicker.wordbank":["clkw"],"application/vnd.criticaltools.wbs+xml":["wbs"],"application/vnd.ctc-posml":["pml"],"application/vnd.cups-ppd":["ppd"],"application/vnd.curl.car":["car"],"application/vnd.curl.pcurl":["pcurl"],"application/vnd.dart":["dart"],"application/vnd.data-vision.rdz":["rdz"],"application/vnd.dbf":["dbf"],"application/vnd.dece.data":["uvf","uvvf","uvd","uvvd"],"application/vnd.dece.ttml+xml":["uvt","uvvt"],"application/vnd.dece.unspecified":["uvx","uvvx"],"application/vnd.dece.zip":["uvz","uvvz"],"application/vnd.denovo.fcselayout-link":["fe_launch"],"application/vnd.dna":["dna"],"application/vnd.dolby.mlp":["mlp"],"application/vnd.dpgraph":["dpg"],"application/vnd.dreamfactory":["dfac"],"application/vnd.ds-keypoint":["kpxx"],"application/vnd.dvb.ait":["ait"],"application/vnd.dvb.service":["svc"],"application/vnd.dynageo":["geo"],"application/vnd.ecowin.chart":["mag"],"application/vnd.enliven":["nml"],"application/vnd.epson.esf":["esf"],"application/vnd.epson.msf":["msf"],"application/vnd.epson.quickanime":["qam"],"application/vnd.epson.salt":["slt"],"application/vnd.epson.ssf":["ssf"],"application/vnd.eszigno3+xml":["es3","et3"],"application/vnd.ezpix-album":["ez2"],"application/vnd.ezpix-package":["ez3"],"application/vnd.fdf":["fdf"],"application/vnd.fdsn.mseed":["mseed"],"application/vnd.fdsn.seed":["seed","dataless"],"application/vnd.flographit":["gph"],"application/vnd.fluxtime.clip":["ftc"],"application/vnd.framemaker":["fm","frame","maker","book"],"application/vnd.frogans.fnc":["fnc"],"application/vnd.frogans.ltf":["ltf"],"application/vnd.fsc.weblaunch":["fsc"],"application/vnd.fujitsu.oasys":["oas"],"application/vnd.fujitsu.oasys2":["oa2"],"application/vnd.fujitsu.oasys3":["oa3"],"application/vnd.fujitsu.oasysgp":["fg5"],"application/vnd.fujitsu.oasysprs":["bh2"],"application/vnd.fujixerox.ddd":["ddd"],"application/vnd.fujixerox.docuworks":["xdw"],"application/vnd.fujixerox.docuworks.binder":["xbd"],"application/vnd.fuzzysheet":["fzs"],"application/vnd.genomatix.tuxedo":["txd"],"application/vnd.geogebra.file":["ggb"],"application/vnd.geogebra.tool":["ggt"],"application/vnd.geometry-explorer":["gex","gre"],"application/vnd.geonext":["gxt"],"application/vnd.geoplan":["g2w"],"application/vnd.geospace":["g3w"],"application/vnd.gmx":["gmx"],"application/vnd.google-apps.document":["gdoc"],"application/vnd.google-apps.presentation":["gslides"],"application/vnd.google-apps.spreadsheet":["gsheet"],"application/vnd.google-earth.kml+xml":["kml"],"application/vnd.google-earth.kmz":["kmz"],"application/vnd.grafeq":["gqf","gqs"],"application/vnd.groove-account":["gac"],"application/vnd.groove-help":["ghf"],"application/vnd.groove-identity-message":["gim"],"application/vnd.groove-injector":["grv"],"application/vnd.groove-tool-message":["gtm"],"application/vnd.groove-tool-template":["tpl"],"application/vnd.groove-vcard":["vcg"],"application/vnd.hal+xml":["hal"],"application/vnd.handheld-entertainment+xml":["zmm"],"application/vnd.hbci":["hbci"],"application/vnd.hhe.lesson-player":["les"],"application/vnd.hp-hpgl":["hpgl"],"application/vnd.hp-hpid":["hpid"],"application/vnd.hp-hps":["hps"],"application/vnd.hp-jlyt":["jlt"],"application/vnd.hp-pcl":["pcl"],"application/vnd.hp-pclxl":["pclxl"],"application/vnd.hydrostatix.sof-data":["sfd-hdstx"],"application/vnd.ibm.minipay":["mpy"],"application/vnd.ibm.modcap":["afp","listafp","list3820"],"application/vnd.ibm.rights-management":["irm"],"application/vnd.ibm.secure-container":["sc"],"application/vnd.iccprofile":["icc","icm"],"application/vnd.igloader":["igl"],"application/vnd.immervision-ivp":["ivp"],"application/vnd.immervision-ivu":["ivu"],"application/vnd.insors.igm":["igm"],"application/vnd.intercon.formnet":["xpw","xpx"],"application/vnd.intergeo":["i2g"],"application/vnd.intu.qbo":["qbo"],"application/vnd.intu.qfx":["qfx"],"application/vnd.ipunplugged.rcprofile":["rcprofile"],"application/vnd.irepository.package+xml":["irp"],"application/vnd.is-xpr":["xpr"],"application/vnd.isac.fcs":["fcs"],"application/vnd.jam":["jam"],"application/vnd.jcp.javame.midlet-rms":["rms"],"application/vnd.jisp":["jisp"],"application/vnd.joost.joda-archive":["joda"],"application/vnd.kahootz":["ktz","ktr"],"application/vnd.kde.karbon":["karbon"],"application/vnd.kde.kchart":["chrt"],"application/vnd.kde.kformula":["kfo"],"application/vnd.kde.kivio":["flw"],"application/vnd.kde.kontour":["kon"],"application/vnd.kde.kpresenter":["kpr","kpt"],"application/vnd.kde.kspread":["ksp"],"application/vnd.kde.kword":["kwd","kwt"],"application/vnd.kenameaapp":["htke"],"application/vnd.kidspiration":["kia"],"application/vnd.kinar":["kne","knp"],"application/vnd.koan":["skp","skd","skt","skm"],"application/vnd.kodak-descriptor":["sse"],"application/vnd.las.las+xml":["lasxml"],"application/vnd.llamagraphics.life-balance.desktop":["lbd"],"application/vnd.llamagraphics.life-balance.exchange+xml":["lbe"],"application/vnd.lotus-1-2-3":["123"],"application/vnd.lotus-approach":["apr"],"application/vnd.lotus-freelance":["pre"],"application/vnd.lotus-notes":["nsf"],"application/vnd.lotus-organizer":["org"],"application/vnd.lotus-screencam":["scm"],"application/vnd.lotus-wordpro":["lwp"],"application/vnd.macports.portpkg":["portpkg"],"application/vnd.mcd":["mcd"],"application/vnd.medcalcdata":["mc1"],"application/vnd.mediastation.cdkey":["cdkey"],"application/vnd.mfer":["mwf"],"application/vnd.mfmp":["mfm"],"application/vnd.micrografx.flo":["flo"],"application/vnd.micrografx.igx":["igx"],"application/vnd.mif":["mif"],"application/vnd.mobius.daf":["daf"],"application/vnd.mobius.dis":["dis"],"application/vnd.mobius.mbk":["mbk"],"application/vnd.mobius.mqy":["mqy"],"application/vnd.mobius.msl":["msl"],"application/vnd.mobius.plc":["plc"],"application/vnd.mobius.txf":["txf"],"application/vnd.mophun.application":["mpn"],"application/vnd.mophun.certificate":["mpc"],"application/vnd.mozilla.xul+xml":["xul"],"application/vnd.ms-artgalry":["cil"],"application/vnd.ms-cab-compressed":["cab"],"application/vnd.ms-excel":["xls","xlm","xla","xlc","xlt","xlw"],"application/vnd.ms-excel.addin.macroenabled.12":["xlam"],"application/vnd.ms-excel.sheet.binary.macroenabled.12":["xlsb"],"application/vnd.ms-excel.sheet.macroenabled.12":["xlsm"],"application/vnd.ms-excel.template.macroenabled.12":["xltm"],"application/vnd.ms-fontobject":["eot"],"application/vnd.ms-htmlhelp":["chm"],"application/vnd.ms-ims":["ims"],"application/vnd.ms-lrm":["lrm"],"application/vnd.ms-officetheme":["thmx"],"application/vnd.ms-outlook":["msg"],"application/vnd.ms-pki.seccat":["cat"],"application/vnd.ms-pki.stl":["*stl"],"application/vnd.ms-powerpoint":["ppt","pps","pot"],"application/vnd.ms-powerpoint.addin.macroenabled.12":["ppam"],"application/vnd.ms-powerpoint.presentation.macroenabled.12":["pptm"],"application/vnd.ms-powerpoint.slide.macroenabled.12":["sldm"],"application/vnd.ms-powerpoint.slideshow.macroenabled.12":["ppsm"],"application/vnd.ms-powerpoint.template.macroenabled.12":["potm"],"application/vnd.ms-project":["mpp","mpt"],"application/vnd.ms-word.document.macroenabled.12":["docm"],"application/vnd.ms-word.template.macroenabled.12":["dotm"],"application/vnd.ms-works":["wps","wks","wcm","wdb"],"application/vnd.ms-wpl":["wpl"],"application/vnd.ms-xpsdocument":["xps"],"application/vnd.mseq":["mseq"],"application/vnd.musician":["mus"],"application/vnd.muvee.style":["msty"],"application/vnd.mynfc":["taglet"],"application/vnd.neurolanguage.nlu":["nlu"],"application/vnd.nitf":["ntf","nitf"],"application/vnd.noblenet-directory":["nnd"],"application/vnd.noblenet-sealer":["nns"],"application/vnd.noblenet-web":["nnw"],"application/vnd.nokia.n-gage.ac+xml":["*ac"],"application/vnd.nokia.n-gage.data":["ngdat"],"application/vnd.nokia.n-gage.symbian.install":["n-gage"],"application/vnd.nokia.radio-preset":["rpst"],"application/vnd.nokia.radio-presets":["rpss"],"application/vnd.novadigm.edm":["edm"],"application/vnd.novadigm.edx":["edx"],"application/vnd.novadigm.ext":["ext"],"application/vnd.oasis.opendocument.chart":["odc"],"application/vnd.oasis.opendocument.chart-template":["otc"],"application/vnd.oasis.opendocument.database":["odb"],"application/vnd.oasis.opendocument.formula":["odf"],"application/vnd.oasis.opendocument.formula-template":["odft"],"application/vnd.oasis.opendocument.graphics":["odg"],"application/vnd.oasis.opendocument.graphics-template":["otg"],"application/vnd.oasis.opendocument.image":["odi"],"application/vnd.oasis.opendocument.image-template":["oti"],"application/vnd.oasis.opendocument.presentation":["odp"],"application/vnd.oasis.opendocument.presentation-template":["otp"],"application/vnd.oasis.opendocument.spreadsheet":["ods"],"application/vnd.oasis.opendocument.spreadsheet-template":["ots"],"application/vnd.oasis.opendocument.text":["odt"],"application/vnd.oasis.opendocument.text-master":["odm"],"application/vnd.oasis.opendocument.text-template":["ott"],"application/vnd.oasis.opendocument.text-web":["oth"],"application/vnd.olpc-sugar":["xo"],"application/vnd.oma.dd2+xml":["dd2"],"application/vnd.openblox.game+xml":["obgx"],"application/vnd.openofficeorg.extension":["oxt"],"application/vnd.openstreetmap.data+xml":["osm"],"application/vnd.openxmlformats-officedocument.presentationml.presentation":["pptx"],"application/vnd.openxmlformats-officedocument.presentationml.slide":["sldx"],"application/vnd.openxmlformats-officedocument.presentationml.slideshow":["ppsx"],"application/vnd.openxmlformats-officedocument.presentationml.template":["potx"],"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":["xlsx"],"application/vnd.openxmlformats-officedocument.spreadsheetml.template":["xltx"],"application/vnd.openxmlformats-officedocument.wordprocessingml.document":["docx"],"application/vnd.openxmlformats-officedocument.wordprocessingml.template":["dotx"],"application/vnd.osgeo.mapguide.package":["mgp"],"application/vnd.osgi.dp":["dp"],"application/vnd.osgi.subsystem":["esa"],"application/vnd.palm":["pdb","pqa","oprc"],"application/vnd.pawaafile":["paw"],"application/vnd.pg.format":["str"],"application/vnd.pg.osasli":["ei6"],"application/vnd.picsel":["efif"],"application/vnd.pmi.widget":["wg"],"application/vnd.pocketlearn":["plf"],"application/vnd.powerbuilder6":["pbd"],"application/vnd.previewsystems.box":["box"],"application/vnd.proteus.magazine":["mgz"],"application/vnd.publishare-delta-tree":["qps"],"application/vnd.pvi.ptid1":["ptid"],"application/vnd.quark.quarkxpress":["qxd","qxt","qwd","qwt","qxl","qxb"],"application/vnd.rar":["rar"],"application/vnd.realvnc.bed":["bed"],"application/vnd.recordare.musicxml":["mxl"],"application/vnd.recordare.musicxml+xml":["musicxml"],"application/vnd.rig.cryptonote":["cryptonote"],"application/vnd.rim.cod":["cod"],"application/vnd.rn-realmedia":["rm"],"application/vnd.rn-realmedia-vbr":["rmvb"],"application/vnd.route66.link66+xml":["link66"],"application/vnd.sailingtracker.track":["st"],"application/vnd.seemail":["see"],"application/vnd.sema":["sema"],"application/vnd.semd":["semd"],"application/vnd.semf":["semf"],"application/vnd.shana.informed.formdata":["ifm"],"application/vnd.shana.informed.formtemplate":["itp"],"application/vnd.shana.informed.interchange":["iif"],"application/vnd.shana.informed.package":["ipk"],"application/vnd.simtech-mindmapper":["twd","twds"],"application/vnd.smaf":["mmf"],"application/vnd.smart.teacher":["teacher"],"application/vnd.software602.filler.form+xml":["fo"],"application/vnd.solent.sdkm+xml":["sdkm","sdkd"],"application/vnd.spotfire.dxp":["dxp"],"application/vnd.spotfire.sfs":["sfs"],"application/vnd.stardivision.calc":["sdc"],"application/vnd.stardivision.draw":["sda"],"application/vnd.stardivision.impress":["sdd"],"application/vnd.stardivision.math":["smf"],"application/vnd.stardivision.writer":["sdw","vor"],"application/vnd.stardivision.writer-global":["sgl"],"application/vnd.stepmania.package":["smzip"],"application/vnd.stepmania.stepchart":["sm"],"application/vnd.sun.wadl+xml":["wadl"],"application/vnd.sun.xml.calc":["sxc"],"application/vnd.sun.xml.calc.template":["stc"],"application/vnd.sun.xml.draw":["sxd"],"application/vnd.sun.xml.draw.template":["std"],"application/vnd.sun.xml.impress":["sxi"],"application/vnd.sun.xml.impress.template":["sti"],"application/vnd.sun.xml.math":["sxm"],"application/vnd.sun.xml.writer":["sxw"],"application/vnd.sun.xml.writer.global":["sxg"],"application/vnd.sun.xml.writer.template":["stw"],"application/vnd.sus-calendar":["sus","susp"],"application/vnd.svd":["svd"],"application/vnd.symbian.install":["sis","sisx"],"application/vnd.syncml+xml":["xsm"],"application/vnd.syncml.dm+wbxml":["bdm"],"application/vnd.syncml.dm+xml":["xdm"],"application/vnd.syncml.dmddf+xml":["ddf"],"application/vnd.tao.intent-module-archive":["tao"],"application/vnd.tcpdump.pcap":["pcap","cap","dmp"],"application/vnd.tmobile-livetv":["tmo"],"application/vnd.trid.tpt":["tpt"],"application/vnd.triscape.mxs":["mxs"],"application/vnd.trueapp":["tra"],"application/vnd.ufdl":["ufd","ufdl"],"application/vnd.uiq.theme":["utz"],"application/vnd.umajin":["umj"],"application/vnd.unity":["unityweb"],"application/vnd.uoml+xml":["uoml"],"application/vnd.vcx":["vcx"],"application/vnd.visio":["vsd","vst","vss","vsw"],"application/vnd.visionary":["vis"],"application/vnd.vsf":["vsf"],"application/vnd.wap.wbxml":["wbxml"],"application/vnd.wap.wmlc":["wmlc"],"application/vnd.wap.wmlscriptc":["wmlsc"],"application/vnd.webturbo":["wtb"],"application/vnd.wolfram.player":["nbp"],"application/vnd.wordperfect":["wpd"],"application/vnd.wqd":["wqd"],"application/vnd.wt.stf":["stf"],"application/vnd.xara":["xar"],"application/vnd.xfdl":["xfdl"],"application/vnd.yamaha.hv-dic":["hvd"],"application/vnd.yamaha.hv-script":["hvs"],"application/vnd.yamaha.hv-voice":["hvp"],"application/vnd.yamaha.openscoreformat":["osf"],"application/vnd.yamaha.openscoreformat.osfpvg+xml":["osfpvg"],"application/vnd.yamaha.smaf-audio":["saf"],"application/vnd.yamaha.smaf-phrase":["spf"],"application/vnd.yellowriver-custom-menu":["cmp"],"application/vnd.zul":["zir","zirz"],"application/vnd.zzazz.deck+xml":["zaz"],"application/x-7z-compressed":["7z"],"application/x-abiword":["abw"],"application/x-ace-compressed":["ace"],"application/x-apple-diskimage":["*dmg"],"application/x-arj":["arj"],"application/x-authorware-bin":["aab","x32","u32","vox"],"application/x-authorware-map":["aam"],"application/x-authorware-seg":["aas"],"application/x-bcpio":["bcpio"],"application/x-bdoc":["*bdoc"],"application/x-bittorrent":["torrent"],"application/x-blorb":["blb","blorb"],"application/x-bzip":["bz"],"application/x-bzip2":["bz2","boz"],"application/x-cbr":["cbr","cba","cbt","cbz","cb7"],"application/x-cdlink":["vcd"],"application/x-cfs-compressed":["cfs"],"application/x-chat":["chat"],"application/x-chess-pgn":["pgn"],"application/x-chrome-extension":["crx"],"application/x-cocoa":["cco"],"application/x-conference":["nsc"],"application/x-cpio":["cpio"],"application/x-csh":["csh"],"application/x-debian-package":["*deb","udeb"],"application/x-dgc-compressed":["dgc"],"application/x-director":["dir","dcr","dxr","cst","cct","cxt","w3d","fgd","swa"],"application/x-doom":["wad"],"application/x-dtbncx+xml":["ncx"],"application/x-dtbook+xml":["dtb"],"application/x-dtbresource+xml":["res"],"application/x-dvi":["dvi"],"application/x-envoy":["evy"],"application/x-eva":["eva"],"application/x-font-bdf":["bdf"],"application/x-font-ghostscript":["gsf"],"application/x-font-linux-psf":["psf"],"application/x-font-pcf":["pcf"],"application/x-font-snf":["snf"],"application/x-font-type1":["pfa","pfb","pfm","afm"],"application/x-freearc":["arc"],"application/x-futuresplash":["spl"],"application/x-gca-compressed":["gca"],"application/x-glulx":["ulx"],"application/x-gnumeric":["gnumeric"],"application/x-gramps-xml":["gramps"],"application/x-gtar":["gtar"],"application/x-hdf":["hdf"],"application/x-httpd-php":["php"],"application/x-install-instructions":["install"],"application/x-iso9660-image":["*iso"],"application/x-java-archive-diff":["jardiff"],"application/x-java-jnlp-file":["jnlp"],"application/x-keepass2":["kdbx"],"application/x-latex":["latex"],"application/x-lua-bytecode":["luac"],"application/x-lzh-compressed":["lzh","lha"],"application/x-makeself":["run"],"application/x-mie":["mie"],"application/x-mobipocket-ebook":["prc","mobi"],"application/x-ms-application":["application"],"application/x-ms-shortcut":["lnk"],"application/x-ms-wmd":["wmd"],"application/x-ms-wmz":["wmz"],"application/x-ms-xbap":["xbap"],"application/x-msaccess":["mdb"],"application/x-msbinder":["obd"],"application/x-mscardfile":["crd"],"application/x-msclip":["clp"],"application/x-msdos-program":["*exe"],"application/x-msdownload":["*exe","*dll","com","bat","*msi"],"application/x-msmediaview":["mvb","m13","m14"],"application/x-msmetafile":["*wmf","*wmz","*emf","emz"],"application/x-msmoney":["mny"],"application/x-mspublisher":["pub"],"application/x-msschedule":["scd"],"application/x-msterminal":["trm"],"application/x-mswrite":["wri"],"application/x-netcdf":["nc","cdf"],"application/x-ns-proxy-autoconfig":["pac"],"application/x-nzb":["nzb"],"application/x-perl":["pl","pm"],"application/x-pilot":["*prc","*pdb"],"application/x-pkcs12":["p12","pfx"],"application/x-pkcs7-certificates":["p7b","spc"],"application/x-pkcs7-certreqresp":["p7r"],"application/x-rar-compressed":["*rar"],"application/x-redhat-package-manager":["rpm"],"application/x-research-info-systems":["ris"],"application/x-sea":["sea"],"application/x-sh":["sh"],"application/x-shar":["shar"],"application/x-shockwave-flash":["swf"],"application/x-silverlight-app":["xap"],"application/x-sql":["sql"],"application/x-stuffit":["sit"],"application/x-stuffitx":["sitx"],"application/x-subrip":["srt"],"application/x-sv4cpio":["sv4cpio"],"application/x-sv4crc":["sv4crc"],"application/x-t3vm-image":["t3"],"application/x-tads":["gam"],"application/x-tar":["tar"],"application/x-tcl":["tcl","tk"],"application/x-tex":["tex"],"application/x-tex-tfm":["tfm"],"application/x-texinfo":["texinfo","texi"],"application/x-tgif":["*obj"],"application/x-ustar":["ustar"],"application/x-virtualbox-hdd":["hdd"],"application/x-virtualbox-ova":["ova"],"application/x-virtualbox-ovf":["ovf"],"application/x-virtualbox-vbox":["vbox"],"application/x-virtualbox-vbox-extpack":["vbox-extpack"],"application/x-virtualbox-vdi":["vdi"],"application/x-virtualbox-vhd":["vhd"],"application/x-virtualbox-vmdk":["vmdk"],"application/x-wais-source":["src"],"application/x-web-app-manifest+json":["webapp"],"application/x-x509-ca-cert":["der","crt","pem"],"application/x-xfig":["fig"],"application/x-xliff+xml":["*xlf"],"application/x-xpinstall":["xpi"],"application/x-xz":["xz"],"application/x-zmachine":["z1","z2","z3","z4","z5","z6","z7","z8"],"audio/vnd.dece.audio":["uva","uvva"],"audio/vnd.digital-winds":["eol"],"audio/vnd.dra":["dra"],"audio/vnd.dts":["dts"],"audio/vnd.dts.hd":["dtshd"],"audio/vnd.lucent.voice":["lvp"],"audio/vnd.ms-playready.media.pya":["pya"],"audio/vnd.nuera.ecelp4800":["ecelp4800"],"audio/vnd.nuera.ecelp7470":["ecelp7470"],"audio/vnd.nuera.ecelp9600":["ecelp9600"],"audio/vnd.rip":["rip"],"audio/x-aac":["aac"],"audio/x-aiff":["aif","aiff","aifc"],"audio/x-caf":["caf"],"audio/x-flac":["flac"],"audio/x-m4a":["*m4a"],"audio/x-matroska":["mka"],"audio/x-mpegurl":["m3u"],"audio/x-ms-wax":["wax"],"audio/x-ms-wma":["wma"],"audio/x-pn-realaudio":["ram","ra"],"audio/x-pn-realaudio-plugin":["rmp"],"audio/x-realaudio":["*ra"],"audio/x-wav":["*wav"],"chemical/x-cdx":["cdx"],"chemical/x-cif":["cif"],"chemical/x-cmdf":["cmdf"],"chemical/x-cml":["cml"],"chemical/x-csml":["csml"],"chemical/x-xyz":["xyz"],"image/prs.btif":["btif"],"image/prs.pti":["pti"],"image/vnd.adobe.photoshop":["psd"],"image/vnd.airzip.accelerator.azv":["azv"],"image/vnd.dece.graphic":["uvi","uvvi","uvg","uvvg"],"image/vnd.djvu":["djvu","djv"],"image/vnd.dvb.subtitle":["*sub"],"image/vnd.dwg":["dwg"],"image/vnd.dxf":["dxf"],"image/vnd.fastbidsheet":["fbs"],"image/vnd.fpx":["fpx"],"image/vnd.fst":["fst"],"image/vnd.fujixerox.edmics-mmr":["mmr"],"image/vnd.fujixerox.edmics-rlc":["rlc"],"image/vnd.microsoft.icon":["ico"],"image/vnd.ms-dds":["dds"],"image/vnd.ms-modi":["mdi"],"image/vnd.ms-photo":["wdp"],"image/vnd.net-fpx":["npx"],"image/vnd.pco.b16":["b16"],"image/vnd.tencent.tap":["tap"],"image/vnd.valve.source.texture":["vtf"],"image/vnd.wap.wbmp":["wbmp"],"image/vnd.xiff":["xif"],"image/vnd.zbrush.pcx":["pcx"],"image/x-3ds":["3ds"],"image/x-cmu-raster":["ras"],"image/x-cmx":["cmx"],"image/x-freehand":["fh","fhc","fh4","fh5","fh7"],"image/x-icon":["*ico"],"image/x-jng":["jng"],"image/x-mrsid-image":["sid"],"image/x-ms-bmp":["*bmp"],"image/x-pcx":["*pcx"],"image/x-pict":["pic","pct"],"image/x-portable-anymap":["pnm"],"image/x-portable-bitmap":["pbm"],"image/x-portable-graymap":["pgm"],"image/x-portable-pixmap":["ppm"],"image/x-rgb":["rgb"],"image/x-tga":["tga"],"image/x-xbitmap":["xbm"],"image/x-xpixmap":["xpm"],"image/x-xwindowdump":["xwd"],"message/vnd.wfa.wsc":["wsc"],"model/vnd.collada+xml":["dae"],"model/vnd.dwf":["dwf"],"model/vnd.gdl":["gdl"],"model/vnd.gtw":["gtw"],"model/vnd.mts":["mts"],"model/vnd.opengex":["ogex"],"model/vnd.parasolid.transmit.binary":["x_b"],"model/vnd.parasolid.transmit.text":["x_t"],"model/vnd.usdz+zip":["usdz"],"model/vnd.valve.source.compiled-map":["bsp"],"model/vnd.vtu":["vtu"],"text/prs.lines.tag":["dsc"],"text/vnd.curl":["curl"],"text/vnd.curl.dcurl":["dcurl"],"text/vnd.curl.mcurl":["mcurl"],"text/vnd.curl.scurl":["scurl"],"text/vnd.dvb.subtitle":["sub"],"text/vnd.fly":["fly"],"text/vnd.fmi.flexstor":["flx"],"text/vnd.graphviz":["gv"],"text/vnd.in3d.3dml":["3dml"],"text/vnd.in3d.spot":["spot"],"text/vnd.sun.j2me.app-descriptor":["jad"],"text/vnd.wap.wml":["wml"],"text/vnd.wap.wmlscript":["wmls"],"text/x-asm":["s","asm"],"text/x-c":["c","cc","cxx","cpp","h","hh","dic"],"text/x-component":["htc"],"text/x-fortran":["f","for","f77","f90"],"text/x-handlebars-template":["hbs"],"text/x-java-source":["java"],"text/x-lua":["lua"],"text/x-markdown":["mkd"],"text/x-nfo":["nfo"],"text/x-opml":["opml"],"text/x-org":["*org"],"text/x-pascal":["p","pas"],"text/x-processing":["pde"],"text/x-sass":["sass"],"text/x-scss":["scss"],"text/x-setext":["etx"],"text/x-sfv":["sfv"],"text/x-suse-ymp":["ymp"],"text/x-uuencode":["uu"],"text/x-vcalendar":["vcs"],"text/x-vcard":["vcf"],"video/vnd.dece.hd":["uvh","uvvh"],"video/vnd.dece.mobile":["uvm","uvvm"],"video/vnd.dece.pd":["uvp","uvvp"],"video/vnd.dece.sd":["uvs","uvvs"],"video/vnd.dece.video":["uvv","uvvv"],"video/vnd.dvb.file":["dvb"],"video/vnd.fvt":["fvt"],"video/vnd.mpegurl":["mxu","m4u"],"video/vnd.ms-playready.media.pyv":["pyv"],"video/vnd.uvvu.mp4":["uvu","uvvu"],"video/vnd.vivo":["viv"],"video/x-f4v":["f4v"],"video/x-fli":["fli"],"video/x-flv":["flv"],"video/x-m4v":["m4v"],"video/x-matroska":["mkv","mk3d","mks"],"video/x-mng":["mng"],"video/x-ms-asf":["asf","asx"],"video/x-ms-vob":["vob"],"video/x-ms-wm":["wm"],"video/x-ms-wmv":["wmv"],"video/x-ms-wmx":["wmx"],"video/x-ms-wvx":["wvx"],"video/x-msvideo":["avi"],"video/x-sgi-movie":["movie"],"video/x-smv":["smv"],"x-conference/x-cooltalk":["ice"]};
  },{}],78:[function(require,module,exports){
  module.exports = {"application/andrew-inset":["ez"],"application/applixware":["aw"],"application/atom+xml":["atom"],"application/atomcat+xml":["atomcat"],"application/atomdeleted+xml":["atomdeleted"],"application/atomsvc+xml":["atomsvc"],"application/atsc-dwd+xml":["dwd"],"application/atsc-held+xml":["held"],"application/atsc-rsat+xml":["rsat"],"application/bdoc":["bdoc"],"application/calendar+xml":["xcs"],"application/ccxml+xml":["ccxml"],"application/cdfx+xml":["cdfx"],"application/cdmi-capability":["cdmia"],"application/cdmi-container":["cdmic"],"application/cdmi-domain":["cdmid"],"application/cdmi-object":["cdmio"],"application/cdmi-queue":["cdmiq"],"application/cu-seeme":["cu"],"application/dash+xml":["mpd"],"application/davmount+xml":["davmount"],"application/docbook+xml":["dbk"],"application/dssc+der":["dssc"],"application/dssc+xml":["xdssc"],"application/ecmascript":["ecma","es"],"application/emma+xml":["emma"],"application/emotionml+xml":["emotionml"],"application/epub+zip":["epub"],"application/exi":["exi"],"application/fdt+xml":["fdt"],"application/font-tdpfr":["pfr"],"application/geo+json":["geojson"],"application/gml+xml":["gml"],"application/gpx+xml":["gpx"],"application/gxf":["gxf"],"application/gzip":["gz"],"application/hjson":["hjson"],"application/hyperstudio":["stk"],"application/inkml+xml":["ink","inkml"],"application/ipfix":["ipfix"],"application/its+xml":["its"],"application/java-archive":["jar","war","ear"],"application/java-serialized-object":["ser"],"application/java-vm":["class"],"application/javascript":["js","mjs"],"application/json":["json","map"],"application/json5":["json5"],"application/jsonml+json":["jsonml"],"application/ld+json":["jsonld"],"application/lgr+xml":["lgr"],"application/lost+xml":["lostxml"],"application/mac-binhex40":["hqx"],"application/mac-compactpro":["cpt"],"application/mads+xml":["mads"],"application/manifest+json":["webmanifest"],"application/marc":["mrc"],"application/marcxml+xml":["mrcx"],"application/mathematica":["ma","nb","mb"],"application/mathml+xml":["mathml"],"application/mbox":["mbox"],"application/mediaservercontrol+xml":["mscml"],"application/metalink+xml":["metalink"],"application/metalink4+xml":["meta4"],"application/mets+xml":["mets"],"application/mmt-aei+xml":["maei"],"application/mmt-usd+xml":["musd"],"application/mods+xml":["mods"],"application/mp21":["m21","mp21"],"application/mp4":["mp4s","m4p"],"application/mrb-consumer+xml":["*xdf"],"application/mrb-publish+xml":["*xdf"],"application/msword":["doc","dot"],"application/mxf":["mxf"],"application/n-quads":["nq"],"application/n-triples":["nt"],"application/node":["cjs"],"application/octet-stream":["bin","dms","lrf","mar","so","dist","distz","pkg","bpk","dump","elc","deploy","exe","dll","deb","dmg","iso","img","msi","msp","msm","buffer"],"application/oda":["oda"],"application/oebps-package+xml":["opf"],"application/ogg":["ogx"],"application/omdoc+xml":["omdoc"],"application/onenote":["onetoc","onetoc2","onetmp","onepkg"],"application/oxps":["oxps"],"application/p2p-overlay+xml":["relo"],"application/patch-ops-error+xml":["*xer"],"application/pdf":["pdf"],"application/pgp-encrypted":["pgp"],"application/pgp-signature":["asc","sig"],"application/pics-rules":["prf"],"application/pkcs10":["p10"],"application/pkcs7-mime":["p7m","p7c"],"application/pkcs7-signature":["p7s"],"application/pkcs8":["p8"],"application/pkix-attr-cert":["ac"],"application/pkix-cert":["cer"],"application/pkix-crl":["crl"],"application/pkix-pkipath":["pkipath"],"application/pkixcmp":["pki"],"application/pls+xml":["pls"],"application/postscript":["ai","eps","ps"],"application/provenance+xml":["provx"],"application/pskc+xml":["pskcxml"],"application/raml+yaml":["raml"],"application/rdf+xml":["rdf","owl"],"application/reginfo+xml":["rif"],"application/relax-ng-compact-syntax":["rnc"],"application/resource-lists+xml":["rl"],"application/resource-lists-diff+xml":["rld"],"application/rls-services+xml":["rs"],"application/route-apd+xml":["rapd"],"application/route-s-tsid+xml":["sls"],"application/route-usd+xml":["rusd"],"application/rpki-ghostbusters":["gbr"],"application/rpki-manifest":["mft"],"application/rpki-roa":["roa"],"application/rsd+xml":["rsd"],"application/rss+xml":["rss"],"application/rtf":["rtf"],"application/sbml+xml":["sbml"],"application/scvp-cv-request":["scq"],"application/scvp-cv-response":["scs"],"application/scvp-vp-request":["spq"],"application/scvp-vp-response":["spp"],"application/sdp":["sdp"],"application/senml+xml":["senmlx"],"application/sensml+xml":["sensmlx"],"application/set-payment-initiation":["setpay"],"application/set-registration-initiation":["setreg"],"application/shf+xml":["shf"],"application/sieve":["siv","sieve"],"application/smil+xml":["smi","smil"],"application/sparql-query":["rq"],"application/sparql-results+xml":["srx"],"application/srgs":["gram"],"application/srgs+xml":["grxml"],"application/sru+xml":["sru"],"application/ssdl+xml":["ssdl"],"application/ssml+xml":["ssml"],"application/swid+xml":["swidtag"],"application/tei+xml":["tei","teicorpus"],"application/thraud+xml":["tfi"],"application/timestamped-data":["tsd"],"application/toml":["toml"],"application/ttml+xml":["ttml"],"application/ubjson":["ubj"],"application/urc-ressheet+xml":["rsheet"],"application/urc-targetdesc+xml":["td"],"application/voicexml+xml":["vxml"],"application/wasm":["wasm"],"application/widget":["wgt"],"application/winhlp":["hlp"],"application/wsdl+xml":["wsdl"],"application/wspolicy+xml":["wspolicy"],"application/xaml+xml":["xaml"],"application/xcap-att+xml":["xav"],"application/xcap-caps+xml":["xca"],"application/xcap-diff+xml":["xdf"],"application/xcap-el+xml":["xel"],"application/xcap-error+xml":["xer"],"application/xcap-ns+xml":["xns"],"application/xenc+xml":["xenc"],"application/xhtml+xml":["xhtml","xht"],"application/xliff+xml":["xlf"],"application/xml":["xml","xsl","xsd","rng"],"application/xml-dtd":["dtd"],"application/xop+xml":["xop"],"application/xproc+xml":["xpl"],"application/xslt+xml":["*xsl","xslt"],"application/xspf+xml":["xspf"],"application/xv+xml":["mxml","xhvml","xvml","xvm"],"application/yang":["yang"],"application/yin+xml":["yin"],"application/zip":["zip"],"audio/3gpp":["*3gpp"],"audio/adpcm":["adp"],"audio/basic":["au","snd"],"audio/midi":["mid","midi","kar","rmi"],"audio/mobile-xmf":["mxmf"],"audio/mp3":["*mp3"],"audio/mp4":["m4a","mp4a"],"audio/mpeg":["mpga","mp2","mp2a","mp3","m2a","m3a"],"audio/ogg":["oga","ogg","spx"],"audio/s3m":["s3m"],"audio/silk":["sil"],"audio/wav":["wav"],"audio/wave":["*wav"],"audio/webm":["weba"],"audio/xm":["xm"],"font/collection":["ttc"],"font/otf":["otf"],"font/ttf":["ttf"],"font/woff":["woff"],"font/woff2":["woff2"],"image/aces":["exr"],"image/apng":["apng"],"image/avif":["avif"],"image/bmp":["bmp"],"image/cgm":["cgm"],"image/dicom-rle":["drle"],"image/emf":["emf"],"image/fits":["fits"],"image/g3fax":["g3"],"image/gif":["gif"],"image/heic":["heic"],"image/heic-sequence":["heics"],"image/heif":["heif"],"image/heif-sequence":["heifs"],"image/hej2k":["hej2"],"image/hsj2":["hsj2"],"image/ief":["ief"],"image/jls":["jls"],"image/jp2":["jp2","jpg2"],"image/jpeg":["jpeg","jpg","jpe"],"image/jph":["jph"],"image/jphc":["jhc"],"image/jpm":["jpm"],"image/jpx":["jpx","jpf"],"image/jxr":["jxr"],"image/jxra":["jxra"],"image/jxrs":["jxrs"],"image/jxs":["jxs"],"image/jxsc":["jxsc"],"image/jxsi":["jxsi"],"image/jxss":["jxss"],"image/ktx":["ktx"],"image/ktx2":["ktx2"],"image/png":["png"],"image/sgi":["sgi"],"image/svg+xml":["svg","svgz"],"image/t38":["t38"],"image/tiff":["tif","tiff"],"image/tiff-fx":["tfx"],"image/webp":["webp"],"image/wmf":["wmf"],"message/disposition-notification":["disposition-notification"],"message/global":["u8msg"],"message/global-delivery-status":["u8dsn"],"message/global-disposition-notification":["u8mdn"],"message/global-headers":["u8hdr"],"message/rfc822":["eml","mime"],"model/3mf":["3mf"],"model/gltf+json":["gltf"],"model/gltf-binary":["glb"],"model/iges":["igs","iges"],"model/mesh":["msh","mesh","silo"],"model/mtl":["mtl"],"model/obj":["obj"],"model/stl":["stl"],"model/vrml":["wrl","vrml"],"model/x3d+binary":["*x3db","x3dbz"],"model/x3d+fastinfoset":["x3db"],"model/x3d+vrml":["*x3dv","x3dvz"],"model/x3d+xml":["x3d","x3dz"],"model/x3d-vrml":["x3dv"],"text/cache-manifest":["appcache","manifest"],"text/calendar":["ics","ifb"],"text/coffeescript":["coffee","litcoffee"],"text/css":["css"],"text/csv":["csv"],"text/html":["html","htm","shtml"],"text/jade":["jade"],"text/jsx":["jsx"],"text/less":["less"],"text/markdown":["markdown","md"],"text/mathml":["mml"],"text/mdx":["mdx"],"text/n3":["n3"],"text/plain":["txt","text","conf","def","list","log","in","ini"],"text/richtext":["rtx"],"text/rtf":["*rtf"],"text/sgml":["sgml","sgm"],"text/shex":["shex"],"text/slim":["slim","slm"],"text/spdx":["spdx"],"text/stylus":["stylus","styl"],"text/tab-separated-values":["tsv"],"text/troff":["t","tr","roff","man","me","ms"],"text/turtle":["ttl"],"text/uri-list":["uri","uris","urls"],"text/vcard":["vcard"],"text/vtt":["vtt"],"text/xml":["*xml"],"text/yaml":["yaml","yml"],"video/3gpp":["3gp","3gpp"],"video/3gpp2":["3g2"],"video/h261":["h261"],"video/h263":["h263"],"video/h264":["h264"],"video/jpeg":["jpgv"],"video/jpm":["*jpm","jpgm"],"video/mj2":["mj2","mjp2"],"video/mp2t":["ts"],"video/mp4":["mp4","mp4v","mpg4"],"video/mpeg":["mpeg","mpg","mpe","m1v","m2v"],"video/ogg":["ogv"],"video/quicktime":["qt","mov"],"video/webm":["webm"]};
  },{}],79:[function(require,module,exports){
  /**
   * Helpers.
   */
  
  var s = 1000;
  var m = s * 60;
  var h = m * 60;
  var d = h * 24;
  var w = d * 7;
  var y = d * 365.25;
  
  /**
   * Parse or format the given `val`.
   *
   * Options:
   *
   *  - `long` verbose formatting [false]
   *
   * @param {String|Number} val
   * @param {Object} [options]
   * @throws {Error} throw an error if val is not a non-empty string or a number
   * @return {String|Number}
   * @api public
   */
  
  module.exports = function(val, options) {
    options = options || {};
    var type = typeof val;
    if (type === 'string' && val.length > 0) {
      return parse(val);
    } else if (type === 'number' && isFinite(val)) {
      return options.long ? fmtLong(val) : fmtShort(val);
    }
    throw new Error(
      'val is not a non-empty string or a valid number. val=' +
        JSON.stringify(val)
    );
  };
  
  /**
   * Parse the given `str` and return milliseconds.
   *
   * @param {String} str
   * @return {Number}
   * @api private
   */
  
  function parse(str) {
    str = String(str);
    if (str.length > 100) {
      return;
    }
    var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
      str
    );
    if (!match) {
      return;
    }
    var n = parseFloat(match[1]);
    var type = (match[2] || 'ms').toLowerCase();
    switch (type) {
      case 'years':
      case 'year':
      case 'yrs':
      case 'yr':
      case 'y':
        return n * y;
      case 'weeks':
      case 'week':
      case 'w':
        return n * w;
      case 'days':
      case 'day':
      case 'd':
        return n * d;
      case 'hours':
      case 'hour':
      case 'hrs':
      case 'hr':
      case 'h':
        return n * h;
      case 'minutes':
      case 'minute':
      case 'mins':
      case 'min':
      case 'm':
        return n * m;
      case 'seconds':
      case 'second':
      case 'secs':
      case 'sec':
      case 's':
        return n * s;
      case 'milliseconds':
      case 'millisecond':
      case 'msecs':
      case 'msec':
      case 'ms':
        return n;
      default:
        return undefined;
    }
  }
  
  /**
   * Short format for `ms`.
   *
   * @param {Number} ms
   * @return {String}
   * @api private
   */
  
  function fmtShort(ms) {
    var msAbs = Math.abs(ms);
    if (msAbs >= d) {
      return Math.round(ms / d) + 'd';
    }
    if (msAbs >= h) {
      return Math.round(ms / h) + 'h';
    }
    if (msAbs >= m) {
      return Math.round(ms / m) + 'm';
    }
    if (msAbs >= s) {
      return Math.round(ms / s) + 's';
    }
    return ms + 'ms';
  }
  
  /**
   * Long format for `ms`.
   *
   * @param {Number} ms
   * @return {String}
   * @api private
   */
  
  function fmtLong(ms) {
    var msAbs = Math.abs(ms);
    if (msAbs >= d) {
      return plural(ms, msAbs, d, 'day');
    }
    if (msAbs >= h) {
      return plural(ms, msAbs, h, 'hour');
    }
    if (msAbs >= m) {
      return plural(ms, msAbs, m, 'minute');
    }
    if (msAbs >= s) {
      return plural(ms, msAbs, s, 'second');
    }
    return ms + ' ms';
  }
  
  /**
   * Pluralization helper.
   */
  
  function plural(ms, msAbs, n, name) {
    var isPlural = msAbs >= n * 1.5;
    return Math.round(ms / n) + ' ' + name + (isPlural ? 's' : '');
  }
  
  },{}],80:[function(require,module,exports){
  module.exports={
    "name": "puppeteer",
    "version": "2.1.1",
    "description": "A high-level API to control headless Chrome over the DevTools Protocol",
    "main": "index.js",
    "repository": "github:puppeteer/puppeteer",
    "engines": {
      "node": ">=8.16.0"
    },
    "puppeteer": {
      "chromium_revision": "722234"
    },
    "scripts": {
      "unit": "node test/test.js",
      "fjunit": "PUPPETEER_PRODUCT=juggler node test/test.js",
      "funit": "PUPPETEER_PRODUCT=firefox node test/test.js",
      "debug-unit": "node --inspect-brk test/test.js",
      "test-doclint": "node utils/doclint/check_public_api/test/test.js && node utils/doclint/preprocessor/test.js",
      "test": "npm run lint --silent && npm run coverage && npm run test-doclint && npm run test-types && node utils/testrunner/test/test.js",
      "install": "node install.js",
      "lint": "([ \"$CI\" = true ] && eslint --quiet -f codeframe . || eslint .) && npm run tsc && npm run doc",
      "doc": "node utils/doclint/cli.js",
      "coverage": "cross-env COVERAGE=true npm run unit",
      "tsc": "tsc -p .",
      "apply-next-version": "node utils/apply_next_version.js",
      "bundle": "npx browserify -r ./index.js:puppeteer -o utils/browser/puppeteer-web.js",
      "test-types": "node utils/doclint/generate_types && npx -p typescript@2.1 tsc -p utils/doclint/generate_types/test/",
      "unit-bundle": "node utils/browser/test.js"
    },
    "author": "The Chromium Authors",
    "license": "Apache-2.0",
    "dependencies": {
      "@types/mime-types": "^2.1.0",
      "debug": "^4.1.0",
      "extract-zip": "^1.6.6",
      "https-proxy-agent": "^4.0.0",
      "mime": "^2.0.3",
      "mime-types": "^2.1.25",
      "progress": "^2.0.1",
      "proxy-from-env": "^1.0.0",
      "rimraf": "^2.6.1",
      "ws": "^6.1.0"
    },
    "devDependencies": {
      "@types/debug": "0.0.31",
      "@types/extract-zip": "^1.6.2",
      "@types/mime": "^2.0.0",
      "@types/node": "^8.10.34",
      "@types/rimraf": "^2.0.2",
      "@types/ws": "^6.0.1",
      "commonmark": "^0.28.1",
      "cross-env": "^5.0.5",
      "eslint": "^5.15.1",
      "esprima": "^4.0.0",
      "jpeg-js": "^0.3.4",
      "minimist": "^1.2.0",
      "ncp": "^2.0.0",
      "pixelmatch": "^4.0.2",
      "pngjs": "^3.3.3",
      "text-diff": "^1.0.1",
      "typescript": "3.2.2"
    },
    "browser": {
      "./lib/BrowserFetcher.js": false,
      "ws": "./utils/browser/WebSocket",
      "fs": false,
      "child_process": false,
      "rimraf": false,
      "readline": false
    }
  }
  
  },{}],81:[function(require,module,exports){
  module.exports = window.WebSocket;
  
  },{}],"puppeteer":[function(require,module,exports){
  (function (__dirname){(function (){
  /**
   * Copyright 2017 Google Inc. All rights reserved.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
  
  const {helper} = require('./lib/helper');
  const api = require('./lib/api');
  for (const className in api) {
    // Puppeteer-web excludes certain classes from bundle, e.g. BrowserFetcher.
    if (typeof api[className] === 'function')
      helper.installAsyncStackHooks(api[className]);
  }
  
  // If node does not support async await, use the compiled version.
  const Puppeteer = require('./lib/Puppeteer');
  const packageJson = require('./package.json');
  const preferredRevision = packageJson.puppeteer.chromium_revision;
  const isPuppeteerCore = packageJson.name === 'puppeteer-core';
  
  const puppeteer = new Puppeteer(__dirname, preferredRevision, isPuppeteerCore);
  // The introspection in `Helper.installAsyncStackHooks` references `Puppeteer._launcher`
  // before the Puppeteer ctor is called, such that an invalid Launcher is selected at import,
  // so we reset it.
  puppeteer._lazyLauncher = undefined;
  
  module.exports = puppeteer;

  }).call(this)}).call(this,"/")
  },{"./lib/Puppeteer":60,"./lib/api":68,"./lib/helper":69,"./package.json":80}]},{},[]);

window.puppeteer = require('puppeteer');

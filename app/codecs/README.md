# Codecs

WebAssembly builds of libavif (with libaom) and libjxl, from
[jSquash](https://github.com/jamsinclair/jSquash) (Apache-2.0, `LICENSE`;
libavif and libaom BSD-2-Clause, libjxl BSD-3-Clause):

- `avif_enc.js`, `avif_enc.wasm`: `@jsquash/avif` 2.1.1, `codec/enc` (single-threaded)
- `jxl_enc.js`, `jxl_enc.wasm`: `@jsquash/jxl` 1.3.0, `codec/enc` (single-threaded)
- `jxl_dec.js`, `jxl_dec.wasm`: `@jsquash/jxl` 1.3.0, `codec/dec`

Copied as they are. `../codec-worker.js` loads them; `../codec.js` runs
the workers. The threaded builds need a cross-origin-isolated page, which
jEditor isn't, so it runs several single-threaded workers instead.

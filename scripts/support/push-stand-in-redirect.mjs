// Loaded with `node --import` into the application under test by scripts/test-hosted-shape.mjs.
// Never part of a deployment, and it refuses to do anything in production.
//
// The application only accepts a push endpoint that looks like a real one: a public https name on
// the default port. A test cannot own such a name, and loosening that rule for tests would mean the
// rule that ships is not the rule that was tested. So the application is left exactly as it is, and
// this file plays the network instead: a request to the one reserved name below is carried to the
// stand-in push service on this machine. `.test` is reserved by RFC 2606 and can never resolve to a
// real push service, so nothing else is affected.
//
// Only the transport is replaced. The request itself - the VAPID signature, the encrypted body, the
// headers, the timeout - is the one the application built, and the stand-in checks all of it.
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';

const port = Number(process.env.PUSH_STAND_IN_PORT);
const standIn = (() => {
  try { return new URL(process.env.PUSH_STAND_IN_ORIGIN ?? 'https://push.stand-in.test'); } catch { return null; }
})();

if (process.env.NODE_ENV !== 'production' && standIn && standIn.hostname.endsWith('.test') && Number.isInteger(port) && port > 0) {
  const direct = https.request;
  https.request = function request(...args) {
    const options = args.find((value) => value && typeof value === 'object' && !(value instanceof URL));
    const host = options && (options.hostname ?? options.host);
    if (host !== standIn.hostname) return direct.apply(this, args);
    const rest = args.slice(args.indexOf(options) + 1);
    // An https.Agent cannot carry a plain connection; everything else is passed through untouched.
    const carried = { ...options };
    delete carried.agent;
    return http.request({
      ...carried,
      protocol: 'http:',
      hostname: '127.0.0.1',
      host: '127.0.0.1',
      port,
      headers: { ...options.headers, host: standIn.host },
    }, ...rest);
  };
  // The sending library is an ES module. However it imports `https`, it must see this function.
  syncBuiltinESMExports();
}

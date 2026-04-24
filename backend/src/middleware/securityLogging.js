'use strict';

const { redactAny } = require('../security/logRedactor');

function patchConsoleForRedaction() {
  const methods = ['log', 'info', 'warn', 'error', 'debug'];

  methods.forEach((method) => {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      const redactedArgs = args.map((arg) => redactAny(arg));
      original(...redactedArgs);
    };
  });
}

function requestLogMiddleware(req, res, next) {
  const requestLine = `${new Date().toISOString()} - ${req.method} ${req.path}`;
  const authHeader = req.headers.authorization
    ? `Authorization: ${req.headers.authorization}`
    : null;

  if (authHeader) {
    console.log(`${requestLine} ${authHeader}`);
  } else {
    console.log(requestLine);
  }

  next();
}

module.exports = {
  patchConsoleForRedaction,
  requestLogMiddleware,
};

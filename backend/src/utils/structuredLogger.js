function writeLog(level, message, context = {}) {
  const entry = {
    level,
    message,
    trace_timestamp: new Date().toISOString(),
    service_name: context.service_name || 'backend',
    correlationId: context.correlationId || null,
    externalRequestId: context.externalRequestId || null,
    ...context
  };
  delete entry.message;
  delete entry.level;
  const payload = {
    level,
    message,
    ...entry
  };
  const serialized = JSON.stringify(payload);
  if (level === 'error') {
    console.error(serialized);
  } else if (level === 'warn') {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
}

module.exports = {
  logInfo: (message, context) => writeLog('info', message, context),
  logWarn: (message, context) => writeLog('warn', message, context),
  logError: (message, context) => writeLog('error', message, context)
};

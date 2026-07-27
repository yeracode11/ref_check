const DEFAULT_LONG_RUNNING_MS = parseInt(process.env.HTTP_LONG_RUNNING_MS || '900000', 10);

function attachLongRunningTimeouts(ms = DEFAULT_LONG_RUNNING_MS) {
  const timeoutMs = Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_LONG_RUNNING_MS;
  return (req, res, next) => {
    req.setTimeout(timeoutMs);
    res.setTimeout(timeoutMs);
    next();
  };
}

module.exports = {
  attachLongRunningTimeouts,
  DEFAULT_LONG_RUNNING_MS,
};

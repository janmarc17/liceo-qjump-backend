module.exports = function requestLogger(req, res, next) {
  try {
    const now = new Date().toISOString();
  } catch (e) {
    // ignore logging errors
  }
  next();
};

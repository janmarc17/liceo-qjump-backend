function notFoundHandler(req, res, next) {
  res.status(404).json({ message: 'Not Found' });
}

function errorHandler(err, req, res, next) {
  // Basic centralized error handler
  console.error(err && err.stack ? err.stack : err);
  const status = err && err.status ? err.status : 500;
  res.status(status).json({ message: err && err.message ? err.message : 'Internal Server Error' });
}

module.exports = { notFoundHandler, errorHandler };

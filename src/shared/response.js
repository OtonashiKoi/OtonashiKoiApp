function ok(data, message = "ok") {
  return {
    status: "ok",
    code: "OK",
    message,
    data
  };
}

function fail(code, message, data = null) {
  return {
    status: "error",
    code,
    message,
    data
  };
}

module.exports = {
  ok,
  fail
};
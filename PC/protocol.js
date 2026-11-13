/* Shared validation for the server, PC and development controller. */
(function (root) {
  const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const vector = (v, keys) => record(v) && keys.every((key) => Number.isFinite(v[key]));
  const playerId = (id) => id === 'PLAYER_1' || id === 'PLAYER_2';

  function parse(text) {
    if (typeof text !== 'string' || text.length > 65536) return null;
    try {
      const value = JSON.parse(text);
      return record(value) && typeof value.type === 'string' ? value : null;
    } catch { return null; }
  }

  function sensor(m) {
    return record(m) && m.type === 'SENSOR' && playerId(m.sender_id)
      && (m.seq === undefined || (Number.isSafeInteger(m.seq) && m.seq >= 0))
      && Number.isSafeInteger(m.timestamp) && m.timestamp >= 0
      && record(m.payload)
      && vector(m.payload.rotation_vector, ['x', 'y', 'z', 'w'])
      && vector(m.payload.acceleration, ['x', 'y', 'z'])
      && [0, 1, 2].includes(m.payload.button);
  }

  function calibration(m) {
    return record(m) && m.type === 'CALIBRATE_CONFIRM' && playerId(m.sender_id)
      && (m.button_input === undefined || Number.isInteger(m.button_input));
  }

  const api = { parse, sensor, calibration, playerId };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GameProtocol = api;
})(globalThis);

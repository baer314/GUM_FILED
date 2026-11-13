'use strict';
(function (root) {
  let active = false;

  function start(players = [], rates = new Map()) {
    active = true;
    root.InGameFront?.start(() => stop());
    root.InGameFront?.renderPackets(players, rates);
  }

  function stop() {
    active = false;
    root.InGameFront?.stop();
  }

  function onSensorData(playerId, timestamp, payload, players = [], rates = new Map()) {
    root.InGameFront?.updatePose(playerId, payload);
    if (active) root.InGameFront?.renderPackets(players, rates);
  }

  function sync(players = [], rates = new Map()) {
    if (active) root.InGameFront?.renderPackets(players, rates);
  }

  root.InGameBack = {
    start,
    stop,
    onSensorData,
    sync,
    isActive: () => active,
  };
})(globalThis);


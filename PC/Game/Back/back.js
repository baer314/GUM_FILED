const GameBack = {
    MAX_HP: 5,
    ATTACK_SPEED: 3.0,

    STATUS: {
        IDLE: "IDLE",
        ATTACK: "ATTACK",
        DEFENSE: "DEFENSE",
        CHARGE: "CHARGE",
        SMASH: "SMASH",
        STUN: "STUN"
    },

    BUTTON: {
        NONE: 0,
        DEFEND: 1,
        CHARGE: 2
    },

    gameState: "WAITING",

    players: {
        PLAYER_1: null,
        PLAYER_2: null
    },

    myPlayerId: null,

    init: function () {
        console.log("[GameBack] 초기화 시작");
        this.players.PLAYER_1 = this.createPlayer("PLAYER_1");
        this.players.PLAYER_2 = this.createPlayer("PLAYER_2");
        this.gameState = "WAITING";
        console.log("[GameBack] 초기화 완료");
    },

    createPlayer: function (id) {
        return {
            id: id,
            hp: this.MAX_HP,
            status: this.STATUS.IDLE,
            basePos: { x: 0, y: 0, z: 0 },
            calibrated: false,
            sword: {
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0, w: 1 },
                dir: { x: 0, z: 1 }
            },
            attackCountDown: 0,
            chargeTime: 0,
            stunUntil: 0,
            recovery: 0,
            pendingSwing: null
        };
    },

    onReceiveSensorData: function (sender_id, timestamp, payload) {
        if (!payload || !["PLAYER_1", "PLAYER_2"].includes(sender_id)) {
            console.warn("[GameBack] 잘못된 데이터 수신:", sender_id);
            return;
        }

        if (!this.myPlayerId) {
            this.myPlayerId = sender_id;
            console.log("[GameBack] 내 플레이어 ID:", this.myPlayerId);
        }

        const opponentId = sender_id === "PLAYER_1" ? "PLAYER_2" : "PLAYER_1";
        const player = this.players[sender_id];
        const opponent = this.players[opponentId];

        switch (this.gameState) {
            case "CALIBRATING":
                this.handleCalibration(player, payload);
                break;

            case "PLAYING":
                this.handlePlaying(player, opponent, payload, timestamp);
                break;

            default:
                console.log("[GameBack] 대기 중...");
        }
    },

    handleCalibration: function (player, payload) {
        if (!player.basePos.x && !player.basePos.y && !player.basePos.z) {
            player.basePos = {
                x: payload.acceleration.x,
                y: payload.acceleration.y,
                z: payload.acceleration.z
            };
            console.log("[GameBack] 영점 기준값 저장:", player.basePos);
        }
    },

    onCalibrateConfirm: function (playerId) {
        const player = this.players[playerId];
        if (!player) return;

        player.calibrated = true;
        console.log("[GameBack] 영점 확인:", playerId);

        if (this.players.PLAYER_1.calibrated && this.players.PLAYER_2.calibrated) {
            this.gameState = "PLAYING";
            console.log("[GameBack] 영점 완료! 게임 시작!");
            this.showUI("START_MAIN_GAME");
        }
    },

    handlePlaying: function (player, opponent, payload, timestamp) {
        if (player.status === this.STATUS.STUN) {
            if (timestamp < player.stunUntil) {
                return;
            }
            player.status = this.STATUS.IDLE;
        }
        if (player.recovery > 0) {
            player.recovery--;
            if (player.recovery === 0 && player.status !== this.STATUS.STUN) {
                if (player.status !== this.STATUS.DEFENSE && player.status !== this.STATUS.CHARGE) {
                    player.status = this.STATUS.IDLE;
                }
            }
            this.updateSwordPosition(player, payload.rotation_vector);
            this.sendToFront(player);
            return;
        }

        this.processButtonInput(player, payload.button, payload);

        const accel = payload.acceleration;
        const isAttacking = Math.sqrt(
            (accel.x - player.basePos.x) ** 2 +
            (accel.y - player.basePos.y) ** 2 +
            (accel.z - player.basePos.z) ** 2
        ) > this.ATTACK_SPEED;

        if (isAttacking && player.status !== this.STATUS.DEFENSE && player.status !== this.STATUS.CHARGE) {
            if (player.status === this.STATUS.IDLE) {
                if (this.isChargeReady(player)) {
                    player.status = this.STATUS.SMASH;
                    player.chargeTime = 0;
                    console.log("[GameBack] 강타(SMASH) 발동!");
                } else {
                    player.status = this.STATUS.ATTACK;
                }
                player.pendingSwing = { ts: timestamp };
            } else if (this.isChargeReady(player)) {
                player.status = this.STATUS.SMASH;
                player.chargeTime = 0;
                console.log("[GameBack] 강타(SMASH) 발동!");
                player.pendingSwing = { ts: timestamp };
            }
            player.attackCountDown = 10;
        } else if (player.attackCountDown > 0) {
            player.attackCountDown--;
        } else if (player.status === this.STATUS.ATTACK || player.status === this.STATUS.SMASH) {
            player.status = this.STATUS.IDLE;
        }

        this.updateSwordPosition(player, payload.rotation_vector);
        this.checkCollision(player, opponent, timestamp);
        this.sendToFront(player);
    },

    processButtonInput: function (player, button, payload) {
        switch (button) {
            case this.BUTTON.DEFEND:
                if (player.status === this.STATUS.STUN || player.recovery > 0) return;
                player.status = this.STATUS.DEFENSE;
                player.sword.dir = this.getTrailDir(player, payload);
                player.chargeTime = 0;
                break;

            case this.BUTTON.CHARGE:
                if (player.status === this.STATUS.STUN || player.recovery > 0) return;

                if (player.status === this.STATUS.CHARGE) {
                    player.chargeTime++;
                } else if (player.status === this.STATUS.DEFENSE) {
                    player.status = this.STATUS.CHARGE;
                    player.chargeTime = 1;
                } else if (player.status === this.STATUS.IDLE) {
                    player.status = this.STATUS.CHARGE;
                    player.chargeTime = 1;
                }
                break;

            default:
                if (player.status === this.STATUS.DEFENSE) {
                    player.status = this.STATUS.IDLE;
                }
                if (player.status === this.STATUS.CHARGE) {
                    player.chargeTime = 0;
                    player.status = this.STATUS.IDLE;
                    player.recovery = 5;
                }
                break;
        }
    },

    isChargeReady: function (player) {
        return player.chargeTime >= 30;
    },

    updateSwordPosition: function (player, rotVec) {
        if (!player.sword.position) {
            player.sword.position = { x: 0, y: 0, z: 0 };
        }

        const dx = rotVec.x - player.basePos.x;
        const dy = rotVec.y - player.basePos.y;
        const dz = rotVec.z - player.basePos.z;

        player.sword.position.z += dz * 0.01;
        player.sword.position.x += dx * 0.005;

        player.sword.dir = this.getTrailDir(player, { rotation_vector: rotVec });

        player.sword.rotation = {
            x: dx,
            y: dy,
            z: dz,
            w: rotVec.w || 1.0
        };

        const MAX_POS = 5;
        player.sword.position.x = Math.max(-MAX_POS, Math.min(MAX_POS, player.sword.position.x));
        player.sword.position.z = Math.max(-MAX_POS, Math.min(MAX_POS, player.sword.position.z));
    },

    getTrailDir: function (player, payload) {
        const z = payload.rotation_vector.z - player.basePos.z;
        const x = payload.rotation_vector.x - player.basePos.x;

        if (Math.abs(x) + Math.abs(z) < 0.01) {
            return player.sword.dir;
        }

        const len = Math.sqrt(x * x + z * z);
        return { x: x / len, z: z / len };
    },

    getRelation: function (dirA, dirB) {
        const dot = dirA.x * dirB.x + dirA.z * dirB.z;
        if (Math.abs(dot) < 0.5) {
            return "PERPENDICULAR";
        }
        return "PARALLEL";
    },

    checkCollision: function (attacker, defender, timestamp) {
        if (!attacker.pendingSwing) return;

        const simultaneousSwing = defender.pendingSwing && Math.abs(attacker.pendingSwing.ts - defender.pendingSwing.ts) < 200;

        if (!simultaneousSwing && (timestamp - attacker.pendingSwing.ts < 200)) return;

        const relation = this.getRelation(attacker.sword.dir, defender.sword.dir);

        if (simultaneousSwing) {
            attacker.pendingSwing = null;
            defender.pendingSwing = null;

            if (relation === "PERPENDICULAR") {
                console.log("[GameBack] 판정: 패리(Parry)!");
                attacker.recovery = 15;
                defender.recovery = 15;
            } else {
                console.log("[GameBack] 판정: 상호공격(Mutual Hit)!");
                attacker.hp -= 1;
                defender.hp -= 1;
                attacker.recovery = 15;
                defender.recovery = 15;
                if (attacker.hp <= 0 || defender.hp <= 0) this.endGame(attacker.hp > 0 ? attacker.id : defender.id, attacker.hp <= 0 ? attacker.id : defender.id);
            }
            return;
        }

        attacker.pendingSwing = null;
        const defenderBlocks = defender.status === this.STATUS.DEFENSE && relation === "PERPENDICULAR";
        const smashIgnoresDefense = attacker.status === this.STATUS.SMASH;

        if (defenderBlocks && !smashIgnoresDefense) {
            attacker.status = this.STATUS.STUN;
            attacker.stunUntil = timestamp + 800;
            console.log("[GameBack] 판정: 방어 성공!");
        } else {
            const damage = attacker.status === this.STATUS.SMASH ? 2 : 1;
            defender.hp -= damage;
            attacker.recovery = 10;
            defender.recovery = 10;
            console.log(`[GameBack] 판정: 공격 성공! (${damage} 데미지)`);
            if (defender.hp <= 0) this.endGame(attacker.id, defender.id);
        }
    },

    endGame: function (winnerId, loserId) {
        this.gameState = "ENDED";
        console.log("[GameBack] 게임 종료! 승자:", winnerId);

        this.sendToFront({
            action: "GAME_OVER",
            winner: winnerId,
            loser: loserId
        });
    },

    startRoom: function (serverUrl) {
        if (typeof GameNetwork === "undefined") {
            throw new Error("network.js가 로드되지 않았습니다");
        }
        return GameNetwork.createRoom(serverUrl, {
            onRoomCreated: function (room) { GameBack.onRoomCreated(room); },
            onPlayerState: function (playerId, state) { GameBack.onPlayerState(playerId, state); },
            onRoomClosed: function () { GameBack.onRoomClosed(); },
            onError: function (err) { GameBack.onNetworkError(err); }
        });
    },

    onRoomCreated: function (room) {
        console.log("[GameBack] 대기방 생성:", room.room_pin);
        this.gameState = "CALIBRATING";
        this.showUI("SHOW_WAITING_ROOM", {
            room_pin: room.room_pin,
            qr_data: room.qr_data
        });
    },

    onPlayerState: function (playerId, state) {
        if (state === "ready") {
            console.log("[GameBack] 플레이어 연결 완료:", playerId);
            this.showUI("UPDATE_PLAYER_READY", { connected_id: playerId });
        } else if (state === "disconnected") {
            console.log("[GameBack] 플레이어 이탈:", playerId);
            this.showUI("UPDATE_PLAYER_LEFT", { left_id: playerId });
        }
    },

    onRoomClosed: function () {
        console.log("[GameBack] 대기방 종료");
        this.gameState = "WAITING";
        this.myPlayerId = null;
        this.players.PLAYER_1 = this.createPlayer("PLAYER_1");
        this.players.PLAYER_2 = this.createPlayer("PLAYER_2");
    },

    onNetworkError: function (err) {
        console.error("[GameBack] 네트워크 오류:", err.code, err.message);
        this.showUI("SHOW_ERROR", { message: err.message });
    },

    showUI: function (ui_command, data) {
        console.log(`[GameBack->Front] ${ui_command}`, data);
        if (typeof frontApp !== "undefined" && typeof frontApp.showUI === "function") {
            frontApp.showUI(ui_command, data);
        }
    },

    sendToFront: function (data) {
        if (data.id) {
            const result = {
                target_id: data.id,
                status: data.status,
                hp: data.hp,
                sword_transform: {
                    position: data.sword.position,
                    quaternion: data.sword.rotation
                }
            };

            if (typeof frontApp !== "undefined") {
                frontApp.updateRender(result.target_id, result.status, result.hp, result.sword_transform);
            }

            console.log(`[GameBack->Front] ${result.target_id} | ${result.status} | HP:${result.hp}`);
        }
        else if (data.action) {
            console.log(`[GameBack->Front] ${data.action}: ${data.message || ""}`);
        }
    }
};

if (typeof window !== "undefined") {
    window.GameBack = GameBack;
    window.back = GameBack;
}

console.log("[GameBack] 로드 완료 - ready!");
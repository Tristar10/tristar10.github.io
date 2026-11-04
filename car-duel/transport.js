// Car Duel — browser transport.
//
// Gives the page an object that looks like a Socket.io client (on / emit), so
// the original UI code runs unchanged. Behind it:
//   - Solo games and the host of a duel run the game engine (engine.js) in
//     this tab.
//   - The second player connects straight to the host's browser over WebRTC
//     using PeerJS. The room code doubles as the host's peer id.
(function () {
  'use strict';

  const PEER_PREFIX = 'carduel-v1-';
  // Events an opponent's browser may send to the host's engine.
  const GUEST_EVENTS = new Set([
    'join_room', 'rejoin_room', 'ask_question', 'submit_guess',
    'surrender', 'request_rematch', 'accept_rematch'
  ]);

  // Optional PeerJS server settings; the default is the free PeerJS cloud server.
  function peerOptions() {
    return (window.CAR_DUEL_CONFIG && window.CAR_DUEL_CONFIG.peerOptions) || {};
  }

  function setRole(role) {
    try { sessionStorage.setItem('cdRole', role); } catch (e) { /* ignore */ }
  }
  function savedRole() {
    try { return sessionStorage.getItem('cdRole'); } catch (e) { return null; }
  }

  function createSocket() {
    const listeners = new Map();
    function deliver(event, data) {
      (listeners.get(event) || []).forEach((fn) => {
        try { fn(data); } catch (err) { console.error(err); }
      });
    }

    let role = null;      // 'host' (includes solo) or 'guest'
    let local = null;     // engine connection for this tab's player
    let hostPeer = null;  // host: PeerJS peer named after the room code
    let guestPeer = null; // guest: anonymous PeerJS peer
    let conn = null;      // guest: data connection to the host
    let pending = [];     // guest: messages queued until the connection opens

    // ── Host side ──────────────────────────────────────────────────────────
    function becomeHost() {
      if (role === 'guest') leaveGuest();
      role = 'host';
      setRole('host');
      if (!local) {
        local = window.CarDuelEngine.connect('local', (event, data) => {
          deliver(event, data);
          if (event === 'room_created') openRoom(data.roomId);
        });
      }
    }

    function openRoom(roomId) {
      if (hostPeer) hostPeer.destroy();
      const peer = new window.Peer(PEER_PREFIX + roomId, peerOptions());
      hostPeer = peer;

      peer.on('connection', (c) => {
        c.on('open', () => {
          const remote = window.CarDuelEngine.connect('peer:' + c.peer, (event, data) => {
            if (c.open) c.send({ ev: event, d: data });
          });
          c.on('data', (msg) => {
            if (msg && typeof msg.ev === 'string' && GUEST_EVENTS.has(msg.ev)) {
              remote.handle(msg.ev, msg.d);
            }
          });
          c.on('close', () => remote.disconnect('peer closed'));
          c.on('error', () => remote.disconnect('peer error'));
        });
      });

      peer.on('disconnected', () => {
        // Lost the signalling server; existing games keep running, but new
        // joins need it, so reconnect.
        if (!peer.destroyed) peer.reconnect();
      });

      peer.on('error', (err) => {
        console.warn('Host peer error:', err.type, err);
        if (err.type === 'unavailable-id') {
          deliver('error', 'That room code is already taken. Create the room again.');
        } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
          deliver('error', 'Lost the connection used for joining. Your opponent may not be able to join.');
        }
      });
    }

    // ── Guest side ─────────────────────────────────────────────────────────
    function leaveGuest() {
      if (conn) { try { conn.close(); } catch (e) { /* ignore */ } }
      if (guestPeer) { try { guestPeer.destroy(); } catch (e) { /* ignore */ } }
      conn = null;
      guestPeer = null;
      pending = [];
    }

    function joinHost(roomId, event, data) {
      const target = PEER_PREFIX + roomId;
      if (role === 'guest' && conn && conn.peer === target && conn.open) {
        conn.send({ ev: event, d: data });
        return;
      }

      leaveGuest();
      role = 'guest';
      setRole('guest');
      pending = [{ ev: event, d: data }];

      const peer = new window.Peer(peerOptions());
      guestPeer = peer;

      peer.on('open', () => {
        const c = peer.connect(target, { reliable: true });
        conn = c;
        c.on('open', () => {
          pending.forEach((m) => c.send(m));
          pending = [];
        });
        c.on('data', (msg) => {
          if (msg && typeof msg.ev === 'string') deliver(msg.ev, msg.d);
        });
        c.on('close', () => {
          if (conn === c) deliver('opponent_disconnected');
        });
      });

      peer.on('error', (err) => {
        console.warn('Guest peer error:', err.type, err);
        if (err.type === 'peer-unavailable') {
          deliver('error', 'Room not found. Check the code and try again.');
        } else {
          deliver('error', 'Could not connect to the room. Check your connection and try again.');
        }
      });
    }

    // ── Socket.io-like surface ─────────────────────────────────────────────
    const socket = {
      on(event, fn) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(fn);
        return socket;
      },
      emit(event, data) {
        data = data || {};
        switch (event) {
          case 'create_room':
          case 'create_solo_game':
            becomeHost();
            local.handle(event, data);
            return;
          case 'join_room':
            joinHost((data.roomId || '').toUpperCase().trim(), event, data);
            return;
          case 'rejoin_room':
            if (savedRole() === 'guest') {
              joinHost((data.roomId || '').toUpperCase().trim(), event, data);
            } else {
              // The host's game lived in this tab, so a reload ends it; the
              // engine replies that the room no longer exists.
              becomeHost();
              local.handle(event, data);
            }
            return;
          default:
            if (role === 'guest') {
              if (conn && conn.open) conn.send({ ev: event, d: data });
              else pending.push({ ev: event, d: data });
            } else if (local) {
              local.handle(event, data);
            }
        }
      }
    };

    // Mirror Socket.io's initial 'connect' so the page's auto-rejoin runs.
    setTimeout(() => deliver('connect'), 0);
    return socket;
  }

  window.io = createSocket;
})();

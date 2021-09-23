import Service from '/space/js/Service.js'

class View {
  constructor(tagName, classList) {
    this.el = document.createElement(tagName || 'div');
    if (classList)
      this.el.classList.add(...classList);
  }

  addSubview(view) {
    view.removeFromSuperview();
    view.superview = this;
    this.el.appendChild(view.el);
  }

  removeFromSuperview() {
    if (!this.superview)
      return;
    this.superview.el.removeChild(this.el);
    this.superview = null;
  }

  apply() { }
}

class RoomView extends View {
  constructor() {
    super('div', ['room']);
    this.seatViews = [];
  }

  apply(props) {
    const seats = props.seats;
    for (let i = 0; i < this.seatViews.length; i++) {
      if (this.seatViews[i].lastProps != seats[i]) {
        this.seatViews.splice(i, 1)[0].removeFromSuperview();
        i--;
      }
    }
    while (this.seatViews.length < seats.length) {
      const seatView = new SeatView();
      this.seatViews.push(seatView);
      this.addSubview(seatView);
    }
    seats.forEach((seat, i) => {
      this.seatViews[i].apply(seat);
    });
  }
}

class SeatView extends View {
  constructor() {
    super('div', ['seat']);
    this.addSubview(this.header = new View('header'));
    this.header.addSubview(this.name = new View('h3'));
    this.el.appendChild(this.textarea = document.createElement('textarea'));

    this.textarea.addEventListener('input', () => {
      sessionStorage.message = this.textarea.value;
      setMyMessage(this.textarea.value);
    });
  }

  apply(props) {
    if (props.me) {
      this.el.classList.add('me');
      if (!this.initialized) {
        this.textarea.value = props.message || '';
        this.initialized = true;
        this.textarea.focus();

        this.header.addSubview(this.toggleMuteButton = new View('button'));
        this.toggleMuteButton.el.addEventListener('click', toggleMute);
      }
      this.toggleMuteButton.el.textContent = props.muted ? 'unmute mic' : 'mute mic';
    } else {
      this.el.classList.remove('me');
      this.textarea.readOnly = true;
      this.textarea.value = props.message || '';
    }
    this.name.el.textContent = props.name;
    this.lastProps = props;
  }
}

const appEl = document.getElementById('app');

let roomView = new RoomView();
appEl.appendChild(roomView.el);

let me = {};
let seq = 1;

let state = {
  seats: [ ]
};

let seatsById = {};

roomView.apply(state);

const name = sessionStorage.name || (sessionStorage.name = prompt("Name yourself"));
if (!('audioMuted' in sessionStorage))
  sessionStorage.audioMuted = true;

const update = async (id, guest) => {
  if (guest) {
    if (!seatsById[id]) {
      state.seats.push(seatsById[id] = {me: id == 'self'});

      if (id == 'self') {
        const um = await Service.get('userMedia');
        um.observe('audioMuted', audioMuted => {
          update(id, { state: { muted: audioMuted } });
        });
      }
    }
    const seat = seatsById[id];
    if (guest.state)
      Object.assign(seat, (guest.state.toJSON ? guest.state.toJSON() : guest.state));
    if (guest.audioTrack) {
      if (!seat.audioPlayer) {
        seat.audioPlayer = document.createElement('audio');
      }
      seat.audioPlayer.srcObject = new MediaStream([guest.audioTrack]);
      const gestureWrangler = await Service.get('gestureWrangler');
      gestureWrangler.playVideo(seat.audioPlayer);
    }
  } else {
    if (id in seatsById) {
      state.seats.splice(state.seats.indexOf(seatsById[id]), 1);
      const audioPlayer = seatsById[id].audioPlayer;
      if (audioPlayer)
        audioPlayer.srcObject = null;
    }
    delete seatsById[id];
  }
  roomView.apply(state);
};

let setMyMessage;
let toggleMute = async () => {
  (await Service.get('userMedia')).toggleAudioMuted();
};

let wasOpen = false;
Service.get('ws', ws => {
  ws.observe('open', () => {
    if (wasOpen)
      location.reload(true);
    wasOpen = true;
  });
});

Service.get('room', room => {
  room.player.data.name = name;
  room.player.data.message = sessionStorage.message
  room.join();

  room.observe('update', update);

  const guests = room.guests;
  for (const id in guests)
    update(id, guests[id]);

  setMyMessage = message => {
    room.player.data.message = message;
    room.updateImmediately();
  };

  room.observe('updateMedia', (id, guest) => {
    update(id, { audioTrack: guest.audioTrack });
  });
});

Service.get('userMedia', userMedia => {
  userMedia.setRequiredVideoMute(true);
  userMedia.start();
});

Service.get('gestureWrangler', gestureWrangler => {
  gestureWrangler.setPromptEl(joinAudio, joinAudio);
});

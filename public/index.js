"use strict";

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
    this.addSubview(this.name = new View('h3'));
    this.el.appendChild(this.textarea = document.createElement('textarea'));

    this.textarea.addEventListener('input', () => {
      setTimeout(() => {
        sessionStorage.message = this.textarea.value;
        this.send();
      }, 0);
    });
  }

  // Lol layering. Will improve after the prototype.
  send() {
    fetch('/msg', {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/x-www-form-urlencoded' }),
      body: `key=${encodeURIComponent(me.key)}&message=${encodeURIComponent(this.textarea.value)}&seq=${seq++}`
    });
  }

  apply(props) {
    if (props.me) {
      this.el.classList.add('me');
      if (this.textarea.readOnly) {
        this.textarea.readOnly = false;
        if (sessionStorage.message) {
          this.textarea.value = sessionStorage.message;
          this.send();
        }
        this.textarea.focus();
      }
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

let wasOpen = false;
function initEventSource() {
  const es = new EventSource("/talk?name=" + encodeURIComponent(sessionStorage.name || (sessionStorage.name = prompt("Name yourself"))));
  es.addEventListener('talker', e => {
    let d = JSON.parse(e.data);
    if (!seatsById[d.id]) {
      state.seats.push(seatsById[d.id] = {me: d.id == me.id});
    }
    Object.assign(seatsById[d.id], d.state);
    roomView.apply(state);
  });

  es.addEventListener('key', e => {
    me = JSON.parse(e.data);
    if (me.id in seatsById)
      seatsById[me.id].me = true;
    roomView.apply(state);
  });

  es.addEventListener('left', e => {
    let id = e.data;
    if (id in seatsById) {
      state.seats.splice(state.seats.indexOf(seatsById[id]), 1);
    }
    delete seatsById[id];
  roomView.apply(state);
  });

  es.addEventListener('open', e => {
    if (wasOpen)
      location.reload(true);
    wasOpen = true;
  });

  es.addEventListener('error', e => {
    es.close();
    setTimeout(initEventSource, 5000);
  });
};

initEventSource();

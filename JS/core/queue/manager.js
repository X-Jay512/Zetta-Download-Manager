const EventEmitter = require('events');
const { inSchedule } = require('../engine/schedule');

class QueueManager extends EventEmitter {
  constructor(engine, settings) {
    super();
    this.engine = engine;
    this.settings = settings;
    this.maxConcurrent = Infinity;
    this.queue = [];
    this.running = [];
    this.held = false;
    this.scheduleHeld = new Set();
    this._clock = setInterval(() => this._process(), 20000);
    if (this._clock.unref) this._clock.unref();
    this._attachEngineListeners();
  }

  _scheduleClosed() {
    return !inSchedule(this.settings && this.settings.get && this.settings.get('schedule'), new Date());
  }

  _enforceSchedule() {
    if (this._scheduleClosed()) {
      for (const id of [...this.running]) {
        const task = this.engine.getTask && this.engine.getTask(id);
        if (task) task.heldBySchedule = true;
        this.scheduleHeld.add(id);
        this.engine.pause(id);
      }
      return;
    }
    for (const id of [...this.scheduleHeld]) {
      this.scheduleHeld.delete(id);
      const task = this.engine.getTask && this.engine.getTask(id);
      if (task && task.heldBySchedule && task.status === 'paused') {
        task.heldBySchedule = false;
        this.engine.resume(id);
      }
    }
  }

  refreshSchedule() {
    this._process();
  }

  hold() {
    this.held = true;
  }

  release() {
    if (!this.held) return;
    this.held = false;
    this._process();
  }

  _attachEngineListeners() {
    this.engine.on('complete', (id) => {
      this.running = this.running.filter(r => r !== id);
      this.emit('task-complete', id);
      this._process();
    });
    this.engine.on('error', (id) => {
      this.running = this.running.filter(r => r !== id);
      this.emit('task-error', id);
      this._process();
    });
    
    this.engine.on('paused', (id) => this._freeSlot(id));
    this.engine.on('cancelled', (id) => this._freeSlot(id));
  }

  _freeSlot(id) {
    if (this.running.includes(id)) {
      this.running = this.running.filter(r => r !== id);
      this._process();
    }
  }

  setMaxConcurrent(n) {
    const value = Number(n);
    this.maxConcurrent = !Number.isFinite(value) || value <= 0 ? Infinity : Math.floor(value);
    this._process();
  }

  enqueue(record) {
    this.queue = this.queue.filter(r => r.id !== record.id);
    this.running = this.running.filter(r => r !== record.id);
    this.queue.push(record);
    this._process();
  }

  _process() {
    this._enforceSchedule();
    if (this.held || this._scheduleClosed()) return;
    while (this.running.length < this.maxConcurrent && this.queue.length > 0) {
      const record = this.queue.shift();
      this.running.push(record.id);
      this.emit('started', record);
      this.engine.add(record);
    }
  }

  startAll() {
    while (this.queue.length > 0 && this.running.length < this.maxConcurrent) {
      this._process();
    }
  }

  stopAll() {
    for (const id of this.running) {
      this.engine.pause(id);
    }
  }

  getStatus() {
    return { queued: this.queue.length, running: this.running.length, max: this.maxConcurrent };
  }
}

module.exports = { QueueManager };

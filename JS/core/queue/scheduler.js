const EventEmitter = require('events');

class Scheduler extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map();
    this.timers = new Map();
  }

  add(job) {
    this.jobs.set(job.id, job);
    this._schedule(job);
  }

  remove(id) {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.jobs.delete(id);
  }

  _schedule(job) {
    const now = Date.now();
    const target = new Date(job.scheduledAt).getTime();
    const delay = Math.max(0, target - now);

    const timer = setTimeout(() => {
      this.emit('trigger', job);
      if (job.repeat) {
        job.scheduledAt = new Date(Date.now() + job.repeatInterval).toISOString();
        this._schedule(job);
      } else {
        this.jobs.delete(job.id);
        this.timers.delete(job.id);
      }
    }, delay);

    this.timers.set(job.id, timer);
  }

  getAll() {
    return [...this.jobs.values()];
  }

  destroy() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.jobs.clear();
  }
}

module.exports = { Scheduler };

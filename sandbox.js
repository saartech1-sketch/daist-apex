class Sandbox {
  #worker = null;
  #seq = 0;
  #pending = new Map();
  #functions = [];
  #needsLoad = false;
  #queue = Promise.resolve();

  constructor(firstArgument = 1000, secondArgument) {
    const timeoutMs = typeof firstArgument === 'number'
      ? firstArgument
      : typeof secondArgument === 'number' ? secondArgument : 1000;
    const workerUrl = typeof firstArgument === 'string' || firstArgument instanceof URL
      ? firstArgument
      : secondArgument;
    if (
      typeof workerUrl !== 'string'
      && !(workerUrl instanceof URL)
    ) {
      throw new TypeError('Sandbox requires a worker URL string or URL object.');
    }
    if (!workerUrl || workerUrl.toString().includes('#APP_FILES#') || workerUrl.toString().includes('#MIN#')) {
      throw new Error(`APEX did not resolve the sandbox worker URL: ${workerUrl}`);
    }
    this.timeoutMs = timeoutMs;
    this.workerUrl = new URL(workerUrl, window.location.href);
    this.#spawn();
  }

  #spawn() {
    this.#worker?.terminate();
    for (const p of this.#pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Sandbox restarted'));
    }
    this.#pending.clear();
    this.#worker = new Worker(this.workerUrl);
    const worker = this.#worker;
    worker.onmessage = (e) => {
      const p = this.#pending.get(e.data.id);
      if (!p) return;
      this.#pending.delete(e.data.id);
      clearTimeout(p.timer);
      p.resolve(e.data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      if (this.#worker !== worker) return;
      this.#worker = null;
      this.#needsLoad = true;
      const error = new Error(
        `Sandbox worker failed: ${event.message || `Unable to load the worker script: ${this.workerUrl.href}`}`,
      );
      for (const p of this.#pending.values()) {
        clearTimeout(p.timer);
        p.reject(error);
      }
      this.#pending.clear();
      worker.terminate();
    };
    this.#needsLoad = this.#functions.length > 0;
  }

  #call(msg) {
    const call = this.#queue.then(() => this.#execute(msg));
    this.#queue = call.catch(() => {});
    return call;
  }

  #execute(msg) {
    return new Promise((resolve, reject) => {
      if (!this.#worker) this.#spawn();
      const id = ++this.#seq;
      const timeoutMs = msg.type === 'load' ? Math.max(this.timeoutMs, 5000) : this.timeoutMs;
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        this.#spawn();
        reject(new Error(`Timed out after ${timeoutMs} ms (infinite loop?). Sandbox restarted and memory cleared.`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.#worker.postMessage({ ...msg, id });
      } catch (err) {
        this.#pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  async load(functions) {
    this.#functions = functions.map(({ name, code, kind }) => ({ name, code, kind }));
    this.#needsLoad = true;
    const res = await this.#call({ type: 'load', functions: this.#functions });
    this.#needsLoad = false;
    return res.errors || [];
  }

  async reset() {
    await this.#call({ type: 'reset' });
  }

  async tick(world, variables, actions) {
    if (this.#needsLoad) await this.load(this.#functions);
    return this.#call({ type: 'tick', world, variables, actions });
  }

  async evaluateGoal(code, world) {
    return this.#call({ type: 'evaluateGoal', code, world });
  }
}

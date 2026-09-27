(() => {
  "use strict";

  function createStore({ ttlMs, authorizationPattern, createAuthorizationId, now, getInventory, parseNames }) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new Error("The CLI plan lifetime was invalid.");
    if (!(authorizationPattern instanceof RegExp)) throw new Error("The CLI plan authorization pattern was invalid.");
    if (![createAuthorizationId, now, getInventory, parseNames].every((value) => typeof value === "function")) {
      throw new Error("The CLI plan store dependencies were invalid.");
    }

    const plans = new Map();

    function create(plan) {
      const currentTime = now();
      for (const [authorizationId, record] of plans) {
        if (!record || record.expiresAt <= currentTime) plans.delete(authorizationId);
      }
      let authorizationId;
      do authorizationId = createAuthorizationId(); while (plans.has(authorizationId));
      if (!authorizationPattern.test(authorizationId || "")) {
        throw new Error("The generated CLI plan authorization was invalid.");
      }
      plans.set(authorizationId, {
        ...plan,
        issuedAt: currentTime,
        expiresAt: currentTime + ttlMs
      });
      return authorizationId;
    }

    function take({ authorizationId, operation, names, uploadMode = "native" }) {
      if (!authorizationPattern.test(authorizationId || "")) {
        throw new Error("The CLI plan authorization was invalid.");
      }
      const plan = plans.get(authorizationId);
      if (!plan) throw new Error("The CLI plan authorization was not found or was already used.");
      plans.delete(authorizationId);
      if (plan.expiresAt <= now()) throw new Error("The CLI plan authorization expired.");
      const requestedNames = parseNames(names);
      if (plan.operation !== operation || JSON.stringify(plan.requestedNames) !== JSON.stringify(requestedNames)) {
        throw new Error("The CLI plan authorization did not match this operation or file list.");
      }
      if (operation === "upload" && (plan.uploadMode || "native") !== uploadMode) {
        throw new Error("The CLI plan authorization did not match the upload method.");
      }
      return plan;
    }

    function checkInventory(plan, inventory) {
      if (JSON.stringify(plan.inventory) !== JSON.stringify(inventory)) {
        throw new Error("The staged-file inventory changed after planning. No mutation was started.");
      }
      return plan;
    }

    function consume(request) {
      const plan = take(request);
      return checkInventory(plan, Object.prototype.hasOwnProperty.call(request, "inventory") ? request.inventory : getInventory());
    }

    async function consumeAsync({ readInventory, ...request }) {
      if (typeof readInventory !== "function") throw new Error("The CLI inventory reader was invalid.");
      const plan = take(request);
      return checkInventory(plan, await readInventory());
    }

    return Object.freeze({ create, consume, consumeAsync });
  }

  Object.defineProperty(globalThis, "TealEvalBridgePlanStore", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({ createStore })
  });

  if (typeof module !== "undefined" && module.exports) module.exports = globalThis.TealEvalBridgePlanStore;
})();

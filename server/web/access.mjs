const main = document.querySelector("#main");
const account = document.querySelector("#account");
let currentUser = null;
let renderVersion = 0;
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = String(text);
  return e;
};
const button = (text, fn, primary = false) => {
  const b = el("button", primary ? "primary" : "", text);
  b.type = "button";
  b.addEventListener("click", async () => {
    try {
      await fn();
    } catch (error) {
      showError(error);
    }
  });
  return b;
};
const field = (label, type = "text", value = "") => {
  const wrap = el("label", "field", label);
  const input = el(type === "textarea" ? "textarea" : "input");
  if (type !== "textarea") input.type = type;
  input.value = value;
  input.setAttribute("aria-label", label);
  wrap.append(input);
  return { wrap, input };
};
const section = (number, title) => {
  const node = el("section", "section");
  const header = el("header");
  header.append(el("p", "kicker", number), el("h2", "", title));
  node.append(header);
  main.append(node);
  return node;
};
const check = (text, checked = true) => {
  const label = el("label", "checkbox");
  const input = el("input");
  input.type = "checkbox";
  input.checked = checked;
  label.append(input, document.createTextNode(text));
  return { label, input };
};
const utc = (value) =>
  value ? value.replace("T", " ").replace(/\.\d+Z$/, "Z") : "Never";
async function api(path, method = "GET", body) {
  const r = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 204) return null;
  const data = await r.json();
  if (!r.ok) {
    const error = new Error(data.error || `Request failed (${r.status})`);
    error.status = r.status;
    throw error;
  }
  return data;
}
function showError(error) {
  document.querySelector("#page-error")?.remove();
  const box = el("p", "error", error.message ?? String(error));
  box.id = "page-error";
  box.role = "alert";
  main.prepend(box);
}
function message(text) {
  document.querySelector("#page-notice")?.remove();
  const box = el("p", "notice", text);
  box.id = "page-notice";
  box.role = "status";
  main.prepend(box);
}
function nextAuthorize() {
  const next = new URLSearchParams(location.search).get("next");
  if (
    !next ||
    !next.startsWith("/oauth/authorize?") ||
    /[\\#\u0000-\u001f]/.test(next)
  )
    return null;
  const url = new URL(next, location.origin);
  return url.origin === location.origin &&
    url.pathname === "/oauth/authorize" &&
    url.search
    ? url.pathname + url.search
    : null;
}
const providerErrors = {
  identity_not_linked:
    "This identity is not linked. Sign in with your existing local account, then link it in Connections.",
  identity_conflict: "This identity is already linked to another account.",
  state_invalid:
    "The request expired or belongs to another browser. Start again.",
  provider_unavailable:
    "The provider is unavailable. Your local account still works.",
  access_denied: "External authorization was cancelled.",
  account_unavailable:
    "This account is unavailable. Contact the administrator.",
  provider_disabled: "This provider has not been configured.",
  account_pending:
    "Your account is awaiting administrator approval. Sign in after it has been approved.",
  account_rejected:
    "Your registration was rejected. Contact the administrator before trying again.",
  registration_closed:
    "Registration is closed. Ask the administrator for an account.",
  setup_required:
    "Create the first administrator before registering member accounts.",
  last_login_method:
    "Add another sign-in method before unlinking your last identity.",
};
function providerError() {
  const code = new URLSearchParams(location.search).get("access_error");
  if (code && Object.hasOwn(providerErrors, code))
    message(providerErrors[code]);
}
async function providerButtons(target, registrationPolicy = null) {
  try {
    const data = await api("/api/access/providers");
    for (const p of data.items) {
      if (
        registrationPolicy &&
        !registrationPolicy.providers.includes(p.provider)
      )
        continue;
      const card = el("article", "record");
      const b = button(
        registrationPolicy ? `Continue with ${p.name}` : `${p.name} sign in`,
        () => {
          const next = nextAuthorize();
          const query = new URLSearchParams();
          if (registrationPolicy) query.set("intent", "register");
          if (next) query.set("next", next);
          location.assign(p.login_start_url + (query.size ? `?${query}` : ""));
        },
      );
      b.disabled = !p.enabled;
      card.append(
        b,
        el(
          "p",
          "",
          p.enabled
            ? registrationPolicy
              ? "Create a separate member account using this identity."
              : "Use an identity already linked to your account."
            : `${p.name} is not configured. Local password sign-in remains available.`,
        ),
      );
      target.append(card);
    }
  } catch {
    target.append(
      el(
        "p",
        "",
        registrationPolicy
          ? "External registration options are unavailable. Try again or contact the administrator."
          : "Provider options are unavailable. Use your local account.",
      ),
    );
  }
}
function renderAccount() {
  account.replaceChildren();
  if (!currentUser) return;
  account.append(
    el("span", "", `${currentUser.display_name} · ${currentUser.role}`),
    button("Sign out", async () => {
      await api("/api/auth/logout", "POST", {});
      location.assign("/login");
    }),
  );
}
function firstLogin(auth) {
  main.replaceChildren();
  const layout = el("div", "first-login-layout");
  const intro = el("section", "first-login-intro");
  intro.append(
    el("p", "kicker", "COMPILER FOUNDRY / FIRST ENTRY"),
    el("h1", "", "One account. Your foundry."),
    el(
      "p",
      "",
      "Turn keyword expressions into explicit logic. Create the first administrator to open your compiler workspace.",
    ),
  );
  const steps = el("ol", "first-login-steps");
  for (const [title, detail] of [
    [
      "Establish your identity",
      "Choose a local username and a password you will use to sign in.",
    ],
    [
      "Open the workspace",
      "Your first account becomes the administrator and signs in immediately.",
    ],
    [
      "Bring your team",
      "Add member accounts later from Connections. This page closes after setup.",
    ],
  ]) {
    const step = el("li");
    step.append(el("strong", "", title), el("p", "", detail));
    steps.append(step);
  }
  intro.append(
    steps,
    el("p", "first-login-mark", "( identity & access ) → workspace"),
  );
  layout.append(intro);
  const node = el("section", "section login first-login-form");
  const header = el("header");
  header.append(
    el("p", "kicker", "01 / INITIAL ADMINISTRATOR"),
    el("h2", "", "Create your first administrator"),
  );
  node.append(
    header,
    el(
      "p",
      "",
      "This installation has no accounts yet. Your credentials stay with this server.",
    ),
  );
  layout.append(node);
  main.append(layout);
  accountForm(node, auth);
}
async function login() {
  main.replaceChildren();
  const node = section("LOCAL ACCOUNT / SERVER EDITION", "Sign in");
  node.classList.add("login");
  accountForm(node);
  const providers = el("div");
  providers.append(el("h3", "", "Linked external identities"));
  node.append(providers);
  void providerButtons(providers);
  const policy = await api("/api/auth/registration-policy");
  const signup = el("div", "registration-entry");
  if (policy.mode === "closed") {
    signup.append(
      el(
        "p",
        "",
        "New accounts are created by the administrator. Registration is closed.",
      ),
    );
  } else {
    const link = el("a", "", "Create an account");
    const next = nextAuthorize();
    link.href = "/register" + (next ? `?next=${encodeURIComponent(next)}` : "");
    signup.append(
      link,
      el(
        "p",
        "",
        policy.mode === "approval"
          ? "New accounts require administrator approval."
          : "Registration is open. New accounts receive member access.",
      ),
    );
  }
  node.append(signup);
  if (new URLSearchParams(location.search).get("registration") === "pending")
    message(
      "Your account is awaiting administrator approval. No workspace access has been granted yet. Sign in after it has been approved.",
    );
  providerError();
}
async function registration() {
  main.replaceChildren();
  const policy = await api("/api/auth/registration-policy");
  const layout = el("div", "first-login-layout registration-layout");
  const intro = el("section", "first-login-intro");
  intro.append(
    el("p", "kicker", "COMPILER FOUNDRY / MEMBER ENTRY"),
    el("h1", "", "Bring your own perspective."),
    el(
      "p",
      "",
      "Join the workspace to compile expressions, inspect their logic and connect your own tools.",
    ),
    el(
      "p",
      "registration-mode",
      policy.mode === "approval"
        ? "ADMINISTRATOR APPROVAL REQUIRED"
        : policy.mode === "open"
          ? "OPEN MEMBER REGISTRATION"
          : "REGISTRATION CLOSED",
    ),
    el(
      "p",
      "",
      policy.mode === "approval"
        ? "Submit your account for review. An administrator must approve it before you can sign in or use the compiler."
        : policy.mode === "open"
          ? "Your new account receives member access. The first administrator setup remains separate."
          : "Ask the administrator to create an account or reopen registration.",
    ),
    el("p", "first-login-mark", "( your identity ) → shared workspace"),
  );
  const node = el("section", "section login first-login-form");
  const header = el("header");
  header.append(
    el("p", "kicker", "01 / MEMBER ACCOUNT"),
    el(
      "h2",
      "",
      policy.mode === "closed"
        ? "Registration is closed"
        : "Create your account",
    ),
  );
  node.append(header);
  layout.append(intro, node);
  main.append(layout);
  if (policy.mode !== "closed") {
    if (policy.password_enabled) registrationForm(node);
    if (policy.providers.length) {
      const providers = el("div", "registration-providers");
      providers.append(el("h3", "", "Or use an external identity"));
      node.append(providers);
      await providerButtons(providers, policy);
    }
    if (!policy.password_enabled && !policy.providers.length)
      node.append(
        el(
          "p",
          "notice",
          "No registration methods are available. Contact the administrator.",
        ),
      );
  }
  const link = el("a", "", "Already have an account? Sign in");
  const next = nextAuthorize();
  link.href = "/login" + (next ? `?next=${encodeURIComponent(next)}` : "");
  node.append(link);
  providerError();
}
function registrationForm(node) {
  const form = el("form", "stack");
  const username = field("Username"),
    display = field("Display name"),
    password = field("Password", "password"),
    confirm = field("Confirm password", "password");
  username.input.required = true;
  username.input.minLength = 3;
  username.input.maxLength = 64;
  username.input.pattern = "[A-Za-z0-9_.\\-]{3,64}";
  username.input.autocomplete = "username";
  username.input.spellcheck = false;
  username.wrap.append(
    el("small", "", "3–64 letters, numbers, underscores, dots or hyphens."),
  );
  display.input.maxLength = 100;
  display.input.autocomplete = "nickname";
  display.wrap.append(el("small", "", "Optional. Defaults to your username."));
  for (const input of [password.input, confirm.input]) {
    input.required = true;
    input.minLength = 12;
    input.maxLength = 256;
    input.autocomplete = "new-password";
  }
  password.wrap.append(el("small", "", "Use 12–256 characters."));
  const submit = el("button", "primary", "Create account");
  submit.type = "submit";
  form.append(username.wrap, display.wrap, password.wrap, confirm.wrap, submit);
  let busy = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    if (password.input.value !== confirm.input.value) {
      showError(
        new Error("Passwords do not match. Enter the same password twice."),
      );
      confirm.input.focus();
      return;
    }
    busy = true;
    submit.disabled = true;
    submit.textContent = "Creating account…";
    form.setAttribute("aria-busy", "true");
    try {
      const result = await api("/api/auth/register", "POST", {
        username: username.input.value.trim(),
        display_name: display.input.value.trim() || undefined,
        password: password.input.value,
      });
      password.input.value = confirm.input.value = "";
      if (result.status === "pending")
        location.assign("/login?registration=pending");
      else {
        const auth = await api("/api/auth/state");
        if (!auth.user)
          throw new Error("Account created. Sign in to continue.");
        location.assign(nextAuthorize() ?? "/");
      }
    } catch (error) {
      password.input.value = confirm.input.value = "";
      showError(error);
    } finally {
      busy = false;
      submit.disabled = false;
      submit.textContent = "Create account";
      form.setAttribute("aria-busy", "false");
    }
  });
  node.append(form);
}
function accountForm(node, setup) {
  const form = el("form", "stack");
  const user = field("Username"),
    display = field("Display name"),
    password = field("Password", "password"),
    confirm = field("Confirm password", "password"),
    setupToken = field("Deployment setup code", "password");
  user.input.required = true;
  user.input.autocomplete = "username";
  user.input.minLength = 3;
  user.input.maxLength = setup ? 32 : 64;
  user.input.pattern = setup
    ? "[A-Za-z0-9_.\\-]{3,32}"
    : "[A-Za-z0-9_.\\-]{3,64}";
  user.input.spellcheck = false;
  password.input.required = true;
  password.input.minLength = 8;
  password.input.maxLength = setup ? 200 : 256;
  password.input.autocomplete = setup ? "new-password" : "current-password";
  form.append(user.wrap);
  if (setup) {
    user.wrap.append(
      el("small", "", "3–32 letters, numbers, underscores, dots or hyphens."),
    );
    display.input.maxLength = 40;
    display.input.autocomplete = "nickname";
    display.wrap.append(
      el(
        "small",
        "",
        "Optional. Up to 40 characters; defaults to your username.",
      ),
    );
    form.append(display.wrap);
  }
  form.append(password.wrap);
  if (setup) {
    password.wrap.append(el("small", "", "Use 8–200 characters."));
    confirm.input.required = true;
    confirm.input.autocomplete = "new-password";
    confirm.input.minLength = 8;
    confirm.input.maxLength = 200;
    form.append(confirm.wrap);
    if (setup.setup_token_required && setup.setup_token_configured) {
      setupToken.input.required = true;
      setupToken.input.autocomplete = "off";
      setupToken.input.maxLength = 512;
      setupToken.wrap.append(
        el(
          "small",
          "",
          "Use the code configured by your deployment operator. It is used only for this first account.",
        ),
      );
      form.append(setupToken.wrap);
    } else if (setup.setup_token_required) {
      const notice = el(
        "p",
        "notice",
        "Remote setup is locked. Open this service on its loopback interface, use CLI bootstrap, or ask the deployment operator to configure ACCESS_SETUP_TOKEN.",
      );
      notice.role = "status";
      form.append(notice);
    }
  }
  const submit = el(
    "button",
    "primary",
    setup ? "Create administrator" : "Sign in",
  );
  submit.type = "submit";
  const locked = setup?.setup_token_required && !setup.setup_token_configured;
  submit.disabled = Boolean(locked);
  form.append(submit);
  let busy = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || locked) return;
    if (setup && password.input.value !== confirm.input.value) {
      showError(
        new Error("Passwords do not match. Enter the same password twice."),
      );
      confirm.input.focus();
      return;
    }
    busy = true;
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    submit.textContent = setup ? "Creating administrator…" : "Signing in…";
    document.querySelector("#page-error")?.remove();
    try {
      currentUser = await api(
        setup ? "/api/auth/setup" : "/api/auth/login",
        "POST",
        {
          username: user.input.value.trim(),
          password: password.input.value,
          ...(setup
            ? {
                display_name: display.input.value.trim() || undefined,
                ...(setup.setup_token_required
                  ? { setup_token: setupToken.input.value }
                  : {}),
              }
            : {}),
        },
      );
      password.input.value = confirm.input.value = setupToken.input.value = "";
      location.assign(nextAuthorize() ?? "/");
    } catch (error) {
      password.input.value = confirm.input.value = setupToken.input.value = "";
      if (setup && error.status === 409) {
        const next = nextAuthorize();
        location.replace(
          "/login" + (next ? `?next=${encodeURIComponent(next)}` : ""),
        );
        return;
      }
      showError(error);
    } finally {
      busy = false;
      submit.disabled = Boolean(locked);
      form.setAttribute("aria-busy", "false");
      submit.textContent = setup ? "Create administrator" : "Sign in";
    }
  });
  node.append(form);
}
async function compiler() {
  main.replaceChildren();
  const header = el("header", "heading");
  header.append(
    el("div", "", "RUST COMPILER / LIVE LOCAL EXECUTION"),
    el("a", "", "Connections"),
  );
  header.lastChild.href = "/connections";
  main.append(header);
  main.append(el("h1", "", "From expression to instruction."));
  const source = section("01 / SOURCE", "Compile an expression");
  source.classList.add("compiler-source");
  const form = el("form");
  const input = field("Keyword expression", "textarea", "(tea|coffee)&shop!ad");
  input.input.maxLength = 40000;
  input.input.required = true;
  const precise = check("Quote terms (precise mode)");
  const slop = field("Default phrase slop", "number", "20");
  slop.input.min = 0;
  slop.input.max = 4294967295;
  const controls = el("div", "controls");
  const submit = el("button", "primary", "Compile and inspect");
  submit.type = "submit";
  controls.append(precise.label, slop.wrap, submit);
  form.append(input.wrap, controls);
  source.append(form);
  const output = el("section", "compiler-result");
  output.append(el("p", "kicker", "02 / COMPILED QUERY_STRING"));
  const code = el(
    "code",
    "",
    "Compile a source expression to see its actual output.",
  );
  output.append(code);
  main.append(output);
  const inspection = section(
    "03 / WRITTEN STRUCTURE",
    "Clauses and exclusions",
  );
  const area = el("div", "inspector");
  inspection.append(area);
  let data = null;
  const choose = (index) => {
    const clause = data.clauses[index];
    area
      .querySelectorAll("button")
      .forEach((node, i) =>
        node.setAttribute("aria-pressed", String(i === index)),
      );
    area.querySelector(".clause-note")?.remove();
    const note = el("aside", "clause-note");
    note.setAttribute("aria-live", "polite");
    note.append(
      el("p", "kicker", `CLAUSE ${String(index + 1).padStart(2, "0")}`),
      el("h3", "", clause.text ?? "Explicit group"),
    );
    const list = el("dl");
    for (const [label, value] of [
      ["Kind", clause.kind],
      ["Join", clause.joiner ?? "Start / implicit"],
      [
        "Excluded",
        clause.negated ? "Yes — direct exclusion" : "No direct exclusion",
      ],
      [
        "Parent",
        clause.parent === null ? "Query root" : `Clause ${clause.parent + 1}`,
      ],
    ]) {
      const row = el("div");
      row.append(el("dt", "", label), el("dd", "", value));
      list.append(row);
    }
    note.append(list);
    if (clause.output) note.append(el("pre", "", clause.output));
    area.append(note);
  };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      data = await api("/api/compiler/inspect", "POST", {
        expression: input.input.value,
        precise: precise.input.checked,
        default_slop: Number(slop.input.value),
      });
      code.textContent = data.query_string;
      area.replaceChildren();
      const nodes = el("div", "clauses");
      data.clauses.forEach((clause, i) => {
        const b = button(
          `${String(i + 1).padStart(2, "0")} · ${clause.text ?? "( group )"}`,
          () => choose(i),
        );
        b.setAttribute("aria-pressed", "false");
        nodes.append(b);
      });
      area.append(nodes);
      if (data.clauses.length) choose(0);
      else area.append(el("p", "", "This expression has no visible clauses."));
      document.querySelector("#page-error")?.remove();
    } catch (error) {
      code.textContent = "Compilation stopped. Correct the source syntax.";
      area.replaceChildren();
      showError(error);
    } finally {
      submit.disabled = false;
    }
  });
  form.requestSubmit();
}
async function consent() {
  main.replaceChildren();
  const target = section(
    "APPLICATION REQUEST / IMMUTABLE CONSENT",
    "Authorize application",
  );
  target.classList.add("consent");
  const id = new URLSearchParams(location.search).get("request_id");
  if (!id) throw new Error("Missing authorization request ID.");
  const data = await api("/api/access/consents/" + encodeURIComponent(id));
  target.append(
    el("h3", "", data.client_name),
    el(
      "p",
      "",
      `Signed in as ${data.user.display_name} (${data.user.username})`,
    ),
  );
  const dl = el("dl");
  for (const [label, value] of [
    ["Requested scopes", data.scopes.join(" · ")],
    ["Exact resource", data.resource],
    ["Expires (UTC)", utc(data.expires_at)],
  ]) {
    dl.append(el("dt", "", label), el("dd", "", value));
  }
  target.append(
    dl,
    el(
      "p",
      "",
      "This application can only use your currently allowed compiler operations. Revoke the grant at any time in Connections.",
    ),
  );
  const form = el("form", "controls");
  form.method = "post";
  form.action = "/oauth/consent/" + encodeURIComponent(data.request_id);
  for (const [value, text] of [
    ["approve", "Approve access"],
    ["deny", "Deny"],
  ]) {
    const b = el("button", value === "approve" ? "primary" : "", text);
    b.type = "submit";
    b.name = "decision";
    b.value = value;
    form.append(b);
  }
  target.append(form);
}
async function connections() {
  const version = ++renderVersion;
  main.replaceChildren();
  const heading = el("header", "heading");
  const title = el("div");
  title.append(
    el("p", "kicker", "ACCESS CONTROL / COMPILER ACCOUNTS"),
    el("h1", "", "Connections and access"),
    el(
      "p",
      "",
      "Linked identities, personal keys, application grants and actual usage.",
    ),
  );
  heading.append(
    title,
    button("Refresh", () => connections()),
  );
  main.append(heading);
  providerError();
  const [overview, providers] = await Promise.all([
    api("/api/access/overview"),
    api("/api/access/providers"),
  ]);
  if (version !== renderVersion) return;
  const identities = section("01 / IDENTITY", "Linked accounts");
  identities.append(
    el(
      "p",
      "",
      `Local account: ${currentUser.display_name}. Identity links never merge accounts by email.`,
    ),
  );
  const providerGrid = el("div", "providers");
  for (const p of providers.items) {
    const card = el("article", "record");
    card.append(el("h3", "", p.name));
    const identity = overview.identities.find((i) => i.provider === p.provider);
    if (identity) {
      card.append(
        el("p", "", identity.subject_mask),
        el("p", "", `Linked (UTC): ${utc(identity.linked_at)}`),
        button(`Unlink ${p.name}`, async () => {
          await api(
            "/api/access/identities/" + encodeURIComponent(identity.id),
            "DELETE",
          );
          await connections();
          message("Identity unlinked. Local password sign-in is unchanged.");
        }),
      );
    } else {
      const b = button(`Link ${p.name}`, async () => {
        const r = await api(
          "/api/access/identities/" + encodeURIComponent(p.provider) + "/link",
          "POST",
          {},
        );
        location.assign(r.authorization_url);
      });
      b.disabled = !p.enabled;
      card.append(
        el(
          "p",
          "",
          p.enabled
            ? "Not linked."
            : `${p.name} is not configured. Ask the administrator to configure its client.`,
        ),
        b,
      );
    }
    providerGrid.append(card);
  }
  identities.append(providerGrid);
  const keys = section("02 / PERSONAL CREDENTIALS", "API keys");
  const columns = el("div", "columns");
  const form = el("form", "stack");
  const name = field("Key name");
  name.input.required = true;
  name.input.maxLength = 80;
  const days = field("Expires in days", "number", "30");
  days.input.min = 1;
  days.input.max = 90;
  form.append(name.wrap, days.wrap);
  const permission = check("Compile, inspect and extract terms · queries:read");
  const apiCheck = check("API"),
    mcpCheck = check("MCP");
  const fieldset = el("fieldset");
  fieldset.append(
    el("legend", "", "Allowed permissions and audiences"),
    permission.label,
    apiCheck.label,
    mcpCheck.label,
  );
  form.append(fieldset);
  const create = el("button", "primary", "Create API key");
  create.id = "create-key";
  create.type = "submit";
  form.append(
    create,
    el(
      "p",
      "",
      "The original key is returned once. Keys expire in at most 90 days. Revocation and disabled accounts are checked on every call.",
    ),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (
      !permission.input.checked ||
      (!apiCheck.input.checked && !mcpCheck.input.checked)
    ) {
      showError(new Error("Select the permission and at least one audience."));
      return;
    }
    create.disabled = true;
    try {
      const result = await api("/api/access/credentials", "POST", {
        name: name.input.value.trim(),
        scopes: ["queries:read"],
        audiences: [
          ...(apiCheck.input.checked ? ["api"] : []),
          ...(mcpCheck.input.checked ? ["mcp"] : []),
        ],
        expires_in_days: Number(days.input.value),
      });
      records.querySelector(".credential-empty")?.remove();
      records.prepend(credentialRow(result.credential));
      name.input.value = "";
      showSecret(result.token);
    } catch (error) {
      showError(error);
    } finally {
      create.disabled = false;
    }
  });
  const records = el("div");
  records.append(
    el(
      "p",
      "",
      "Lists only reveal a prefix, current scopes, audience and expiry.",
    ),
  );
  if (!overview.credentials.length)
    records.append(el("p", "credential-empty", "No API keys yet."));
  function credentialRow(key) {
    const row = el("article", "record");
    row.append(
      el("h3", "", key.name),
      el("code", "", key.prefix + "…"),
      el(
        "p",
        "",
        key.scopes.join(" · ") +
          " / " +
          key.audiences.join(" · ").toUpperCase(),
      ),
      el("p", "", `Expires (UTC): ${utc(key.expires_at)}`),
      el("p", "", `Last used (UTC): ${utc(key.last_used_at)}`),
    );
    if (key.revoked_at) row.append(el("p", "", "Revoked"));
    else
      row.append(
        button("Revoke " + key.name, async () => {
          await api(
            "/api/access/credentials/" + encodeURIComponent(key.id),
            "DELETE",
          );
          await connections();
          message("Key revoked. Subsequent calls are denied.");
        }),
      );
    return row;
  }
  for (const key of overview.credentials) records.append(credentialRow(key));
  columns.append(form, records);
  keys.append(columns);
  const grants = section("03 / APPLICATIONS", "Application grants");
  if (!overview.grants.length)
    grants.append(el("p", "", "No application grants yet."));
  for (const grant of overview.grants) {
    const row = el("article", "record");
    row.append(
      el("h3", "", grant.client_name),
      el("p", "", grant.scopes.join(" · ")),
      el("code", "", grant.resource),
      el("p", "", `Expires (UTC): ${utc(grant.expires_at)}`),
    );
    if (grant.revoked_at) row.append(el("p", "", "Revoked"));
    else
      row.append(
        button("Revoke application " + grant.client_name, async () => {
          await api(
            "/api/access/grants/" + encodeURIComponent(grant.id),
            "DELETE",
          );
          await connections();
        }),
      );
    grants.append(row);
  }
  const ledger = section("04 / AUDIT REGISTER", "Usage and audit");
  ledger.classList.add("ledger");
  const filters = el("form", "controls");
  const period = el("select");
  period.setAttribute("aria-label", "Date range");
  for (const n of [7, 30, 90]) {
    const o = el("option", "", `Last ${n} days`);
    o.value = n;
    period.append(o);
  }
  const transport = el("select");
  transport.setAttribute("aria-label", "Transport");
  for (const [v, label] of [
    ["", "API and MCP"],
    ["api", "API"],
    ["mcp", "MCP"],
  ]) {
    const o = el("option", "", label);
    o.value = v;
    transport.append(o);
  }
  const outcome = el("select");
  outcome.setAttribute("aria-label", "Outcome");
  for (const v of ["", "success", "failure", "pending", "interrupted"]) {
    const o = el("option", "", v || "All outcomes");
    o.value = v;
    outcome.append(o);
  }
  filters.append(period, transport, outcome);
  const userFilter = field("User ID (blank: me, all: everyone)");
  if (currentUser.role === "admin") filters.append(userFilter.wrap);
  const apply = el("button", "", "Apply filters");
  apply.type = "submit";
  filters.append(apply);
  ledger.append(filters);
  const results = el("div");
  ledger.append(results);
  let cursor = null;
  let ledgerGeneration = 0;
  let appliedQuery = "";
  let pagination = null;
  let moreButton = null;
  const query = () =>
    new URLSearchParams({
      days: period.value,
      ...(transport.value ? { transport: transport.value } : {}),
      ...(outcome.value ? { outcome: outcome.value } : {}),
      ...(currentUser.role === "admin" && userFilter.input.value.trim()
        ? { user_id: userFilter.input.value.trim() }
        : {}),
    }).toString();
  async function loadLedger() {
    const generation = ++ledgerGeneration;
    const requestedQuery = query();
    pagination = null;
    cursor = null;
    if (moreButton) moreButton.disabled = true;
    let usage, events;
    try {
      [usage, events] = await Promise.all([
        api("/api/access/usage?" + requestedQuery),
        api("/api/access/events?" + requestedQuery),
      ]);
    } catch (error) {
      if (generation === ledgerGeneration && version === renderVersion)
        showError(error);
      return;
    }
    if (generation !== ledgerGeneration || version !== renderVersion) return;
    appliedQuery = requestedQuery;
    results.replaceChildren();
    results.append(
      el("p", "", `UTC · Last ${usage.days} days`),
      el(
        "p",
        "",
        `${utc(usage.from)} — ${utc(usage.to)}. MCP discovery is not counted as a domain operation.`,
      ),
    );
    const totals = el("dl", "summary");
    for (const [key, label] of [
      ["attempts", "Attempts"],
      ["successes", "Successes"],
      ["failures", "Failures"],
      ["pending", "Pending"],
    ]) {
      const row = el("div");
      row.append(el("dt", "", label), el("dd", "", usage.totals[key]));
      totals.append(row);
    }
    results.append(totals);
    const bars = el("div", "bars");
    bars.style.gridTemplateColumns = `repeat(${usage.daily.length},minmax(0,1fr))`;
    bars.role = "img";
    bars.setAttribute(
      "aria-label",
      `Actual daily operations over ${usage.days} days`,
    );
    const max = Math.max(1, ...usage.daily.map((d) => d.attempts));
    for (const day of usage.daily) {
      const col = el("div");
      col.title = `${day.date}: ${day.attempts} attempts, ${day.successes} successes, ${day.failures} failures, ${day.pending} pending`;
      const fill = el("span");
      fill.style.height = (day.attempts / max) * 100 + "%";
      col.append(fill, el("small", "", day.date.slice(5)));
      bars.append(col);
    }
    results.append(bars);
    if (!usage.totals.attempts)
      results.append(el("p", "", "No operations in this date range."));
    const scroll = el("div", "table");
    const table = el("table");
    const head = el("thead");
    const header = el("tr");
    for (const label of [
      "Time (UTC)",
      "Transport / operation",
      "Outcome",
      "Request ID",
      "Duration",
    ])
      header.append(el("th", "", label));
    head.append(header);
    const body = el("tbody");
    const seen = new Set();
    const add = (items) => {
      for (const event of items) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        const row = el("tr");
        for (const value of [
          utc(event.at),
          `${event.transport} / ${event.operation}`,
          `${event.outcome} · ${event.status}`,
          event.request_id,
          `${event.duration_ms} ms`,
        ])
          row.append(el("td", "", value));
        body.append(row);
      }
    };
    add(events.items);
    table.append(head, body);
    scroll.append(table);
    results.append(scroll);
    cursor = events.next_cursor;
    if (cursor) {
      const more = button("Load earlier events", async () => {
        if (!cursor || pagination || generation !== ledgerGeneration) return;
        const requestedCursor = cursor;
        const requestedQuery = appliedQuery;
        const page = Symbol("pagination");
        pagination = page;
        more.disabled = true;
        try {
          const next = await api(
            "/api/access/events?" +
              requestedQuery +
              "&cursor=" +
              encodeURIComponent(requestedCursor),
          );
          if (
            generation !== ledgerGeneration ||
            version !== renderVersion ||
            pagination !== page
          )
            return;
          add(next.items);
          cursor = next.next_cursor;
        } catch (error) {
          if (
            generation === ledgerGeneration &&
            version === renderVersion &&
            pagination === page
          )
            showError(error);
        } finally {
          if (pagination === page) {
            pagination = null;
            more.disabled = !cursor;
          }
        }
      });
      moreButton = more;
      results.append(more);
    }
  }
  filters.addEventListener("submit", (event) => {
    event.preventDefault();
    void loadLedger().catch(showError);
  });
  await loadLedger();
  if (version !== renderVersion) return;
  if (currentUser.role === "admin") {
    await registrationAdmin(version);
    if (version !== renderVersion) return;
    await clientRegistry();
    if (version !== renderVersion) return;
    await members();
  }
}
async function registrationAdmin(version) {
  const target = section("05 / MEMBER ENTRY", "Registration policy");
  target.append(
    el(
      "p",
      "",
      "Choose how new members join. Existing accounts keep their current access. The first account is always created through the administrator setup.",
    ),
  );
  const policy = await api("/api/auth/registration-policy");
  if (version !== renderVersion) return;
  const form = el("form", "stack");
  const choices = el("fieldset", "registration-policy");
  choices.append(el("legend", "", "Who can register?"));
  for (const [value, title, detail] of [
    [
      "closed",
      "Closed",
      "Only administrators can create accounts. This is the default.",
    ],
    [
      "approval",
      "Administrator approval",
      "New accounts wait for a review before they can sign in.",
    ],
    ["open", "Open", "New accounts receive member access immediately."],
  ]) {
    const label = el("label", "policy-choice");
    const input = el("input");
    input.type = "radio";
    input.name = "registration-mode";
    input.value = value;
    input.checked = value === policy.mode;
    input.setAttribute("aria-label", title);
    const text = el("span");
    text.append(el("strong", "", title), el("small", "", detail));
    label.append(input, text);
    choices.append(label);
  }
  const save = el("button", "primary", "Save registration policy");
  save.type = "submit";
  form.append(choices, save);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    try {
      await api("/api/auth/registration-policy", "PATCH", {
        mode: new FormData(form).get("registration-mode"),
      });
      await connections();
      message("Registration policy saved.");
    } catch (error) {
      showError(error);
    } finally {
      save.disabled = false;
    }
  });
  target.append(form);
  const queue = section("06 / ACCOUNT REVIEW", "Registration requests");
  queue.append(
    el(
      "p",
      "",
      "Approve verified members or reject a request with a reason. Pending and rejected accounts cannot sign in.",
    ),
  );
  const filter = el("label", "field", "Request status");
  const status = el("select");
  status.setAttribute("aria-label", "Request status");
  for (const [value, label] of [
    ["pending", "Pending review"],
    ["active", "Active"],
    ["rejected", "Rejected"],
  ]) {
    const option = el("option", "", label);
    option.value = value;
    status.append(option);
  }
  filter.append(status);
  const records = el("div", "registration-records");
  queue.append(filter, records);
  let cursor = null,
    generation = 0;
  const more = button("Load earlier requests", () => loadRequests(false));
  more.hidden = true;
  queue.append(more);
  async function loadRequests(reset = true) {
    const requestGeneration = reset ? ++generation : generation;
    const selected = status.value;
    if (reset) {
      cursor = null;
      records.replaceChildren();
    }
    more.disabled = true;
    try {
      const query = new URLSearchParams({ status: selected, limit: "50" });
      if (cursor) query.set("before", cursor);
      const data = await api("/api/auth/registrations?" + query);
      if (requestGeneration !== generation || version !== renderVersion) return;
      if (reset && !data.items.length)
        records.append(
          el(
            "p",
            "empty-state",
            selected === "pending"
              ? "No accounts are waiting for review."
              : "No registrations with this status.",
          ),
        );
      for (const request of data.items)
        records.append(registrationRecord(request));
      cursor = data.next_cursor;
      more.hidden = !cursor;
    } catch (error) {
      if (requestGeneration === generation) showError(error);
    } finally {
      if (requestGeneration === generation) more.disabled = false;
    }
  }
  status.addEventListener("change", () => void loadRequests());
  await loadRequests();
  if (version !== renderVersion) return;
  const history = section("07 / REGISTRATION AUDIT", "Registration history");
  history.append(
    el("p", "", "Policy changes and account decisions, recorded in UTC."),
  );
  const events = el("div");
  history.append(events);
  let eventCursor = null;
  const earlier = button("Load earlier registration history", loadEvents);
  earlier.hidden = true;
  history.append(earlier);
  async function loadEvents() {
    earlier.disabled = true;
    try {
      const data = await api(
        "/api/auth/registration-events?limit=50" +
          (eventCursor ? "&before=" + encodeURIComponent(eventCursor) : ""),
      );
      if (version !== renderVersion) return;
      if (!eventCursor && !data.items.length)
        events.append(el("p", "empty-state", "No registration events yet."));
      const actions = {
        registered: "Account registered",
        approved: "Account approved",
        rejected: "Account rejected",
        policy_changed: "Policy changed",
      };
      for (const event of data.items) {
        const row = el("article", "record registration-event");
        row.append(
          el("h3", "", actions[event.action] ?? event.action),
          el(
            "p",
            "",
            `${utc(event.created_at)} · ${event.actor_username ?? "Public registration"}`,
          ),
        );
        if (event.registration_id)
          row.append(el("p", "", `Request #${event.registration_id}`));
        if (event.mode)
          row.append(el("p", "", `Registration mode: ${event.mode}`));
        if (event.reason) row.append(el("p", "", event.reason));
        events.append(row);
      }
      eventCursor = data.next_cursor;
      earlier.hidden = !eventCursor;
    } catch (error) {
      showError(error);
    } finally {
      earlier.disabled = false;
    }
  }
  await loadEvents();
}
function registrationRecord(request) {
  const row = el("article", "record registration-record");
  row.append(
    el(
      "p",
      "kicker",
      `REQUEST ${String(request.id).padStart(2, "0")} / ${request.provider.toUpperCase()}`,
    ),
    el("h3", "", `${request.display_name} (${request.username})`),
    el(
      "p",
      "",
      `${request.status} · Submitted (UTC): ${utc(request.created_at)}`,
    ),
  );
  if (request.reviewed_at)
    row.append(
      el(
        "p",
        "",
        `Reviewed (UTC): ${utc(request.reviewed_at)} · Administrator #${request.reviewed_by}`,
      ),
    );
  if (request.rejection_reason)
    row.append(el("p", "", request.rejection_reason));
  if (request.status !== "pending") return row;
  const form = el("form", "review-form");
  const reason = field("Rejection reason", "textarea");
  reason.input.maxLength = 500;
  reason.input.required = true;
  reason.wrap.append(
    el("small", "", "Required when rejecting. Up to 500 characters."),
  );
  let busy = false;
  const approve = button("Approve account", () => review("approve"), true);
  const reject = el("button", "", "Reject account");
  reject.type = "submit";
  form.append(reason.wrap, reject);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void review("reject");
  });
  async function review(decision) {
    if (busy) return;
    if (decision === "reject" && !reason.input.value.trim()) {
      reason.input.focus();
      showError(
        new Error("Enter a rejection reason before rejecting this account."),
      );
      return;
    }
    busy = true;
    approve.disabled = reject.disabled = true;
    form.setAttribute("aria-busy", "true");
    try {
      await api(
        `/api/auth/registrations/${encodeURIComponent(request.id)}/review`,
        "POST",
        {
          decision,
          ...(decision === "reject"
            ? { reason: reason.input.value.trim() }
            : {}),
        },
      );
      await connections();
      message(
        decision === "approve"
          ? "Account approved. The member can now sign in."
          : "Account rejected. The reason has been recorded.",
      );
    } catch (error) {
      if (error.status === 409) {
        try {
          await connections();
          message(
            "This request was already reviewed. The queue has been refreshed.",
          );
        } catch (refreshError) {
          showError(refreshError);
        }
      } else showError(error);
    } finally {
      busy = false;
      approve.disabled = reject.disabled = false;
      form.setAttribute("aria-busy", "false");
    }
  }
  row.append(approve, form);
  return row;
}
function showSecret(raw) {
  document.querySelector(".secret")?.remove();
  let secret = raw;
  const panel = el("section", "secret");
  panel.role = "dialog";
  panel.setAttribute("aria-label", "New API key shown once");
  panel.append(
    el("h2", "", "Save this key now"),
    el("p", "", "The original is not available again after closing."),
  );
  const code = el("code", "", secret);
  panel.append(code);
  const controls = el("div", "controls");
  const close = button("Close key value", () => {
    secret = null;
    code.textContent = "";
    panel.remove();
    document.querySelector("#create-key")?.focus();
  });
  controls.append(
    button("Copy key", async () => {
      try {
        await navigator.clipboard.writeText(secret);
        message("Key copied.");
      } catch {
        message("Select the key and copy it manually.");
      }
    }),
    close,
  );
  panel.append(controls);
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close.click();
  });
  document.body.append(panel);
  close.focus();
}
async function clientRegistry() {
  const target = section(
    "08 / OAUTH CLIENT REGISTRY",
    "Registered applications",
  );
  const form = el("form", "stack");
  const name = field("Application name"),
    redirect = field(
      "Redirect URIs (one HTTPS or loopback URI per line)",
      "textarea",
    );
  name.input.required = true;
  name.input.maxLength = 80;
  redirect.input.required = true;
  const submit = el("button", "primary", "Register application");
  submit.type = "submit";
  form.append(name.wrap, redirect.wrap, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      await api("/api/access/clients", "POST", {
        client_name: name.input.value.trim(),
        redirect_uris: redirect.input.value
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      });
      await connections();
      message("Application registered.");
    } catch (error) {
      showError(error);
    } finally {
      submit.disabled = false;
    }
  });
  target.append(form);
  const data = await api("/api/access/clients");
  for (const client of data.items) {
    const row = el("article", "record");
    row.append(
      el("h3", "", client.client_name),
      el("code", "", client.client_id),
    );
    for (const uri of client.redirect_uris) row.append(el("p", "", uri));
    target.append(row);
  }
}
async function members() {
  const target = section("09 / LOCAL ACCOUNTS", "Compiler accounts");
  const form = el("form", "stack");
  const name = field("New username"),
    display = field("New display name"),
    password = field("New temporary password", "password");
  for (const f of [name, display, password]) f.input.required = true;
  password.input.minLength = 8;
  password.input.maxLength = 200;
  const submit = el("button", "", "Create member account");
  submit.type = "submit";
  form.append(name.wrap, display.wrap, password.wrap, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      await api("/api/users", "POST", {
        username: name.input.value.trim(),
        display_name: display.input.value.trim(),
        password: password.input.value,
      });
      password.input.value = "";
      await connections();
      message("Member account created.");
    } catch (error) {
      password.input.value = "";
      showError(error);
    } finally {
      submit.disabled = false;
    }
  });
  target.append(form);
  const data = await api("/api/users");
  for (const user of data.items) {
    const row = el("article", "record");
    row.append(
      el("h3", "", `${user.display_name} (${user.username})`),
      el(
        "p",
        "",
        `${user.role} · ${user.account_status === "pending" ? "Pending approval" : user.account_status === "rejected" ? "Registration rejected" : user.disabled ? "Disabled" : "Active"}`,
      ),
    );
    const change = button(
      user.disabled ? "Enable " + user.username : "Disable " + user.username,
      async () => {
        await api("/api/users/" + user.id, "PATCH", {
          disabled: !user.disabled,
        });
        await connections();
      },
    );
    change.disabled = user.id === currentUser.id;
    row.append(change);
    target.append(row);
  }
}
async function routeAuth(auth) {
  currentUser = auth.user;
  renderAccount();
  const next = nextAuthorize();
  const continuation = next ? `?next=${encodeURIComponent(next)}` : "";
  if (!currentUser) {
    const code = new URLSearchParams(location.search).get("access_error");
    const providerNotice =
      !auth.setup_required && code && Object.hasOwn(providerErrors, code)
        ? `${continuation ? "&" : "?"}access_error=${encodeURIComponent(code)}`
        : "";
    const pendingNotice =
      !auth.setup_required &&
      new URLSearchParams(location.search).get("registration") === "pending"
        ? `${continuation || providerNotice ? "&" : "?"}registration=pending`
        : "";
    const entry = auth.setup_required
      ? "/first-login"
      : location.pathname === "/register"
        ? "/register"
        : "/login";
    const target = entry + continuation + providerNotice + pendingNotice;
    if (location.pathname + location.search !== target) {
      location.replace(target);
      return;
    }
    if (auth.setup_required) firstLogin(auth);
    else if (entry === "/register") await registration();
    else await login();
  } else if (
    ["/login", "/first-login", "/register"].includes(location.pathname)
  ) {
    location.replace(next ?? "/");
  } else if (location.pathname === "/consent") await consent();
  else if (location.pathname === "/connections") await connections();
  else await compiler();
}
try {
  await routeAuth(await api("/api/auth/state"));
} catch (error) {
  showError(error);
}

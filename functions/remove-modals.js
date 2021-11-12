/*THIS SCRIPT IS MEANT TO BE INJECTED IN A VERY SPECIFIC WAY*/

/* eslint-disable semi */
/* eslint-disable no-undef */
(async function (port) {
  const target = document.body || document.documentElement;
  const options = { childList: true, subtree: true };
  async function get(URL) {
    try {
      const response = await fetch(URL);
      const data = await response.text();

      if (response.status !== 200) throw new Error();

      return data.split("\n");
    } catch {
      return [];
    }
  }

  function buildObserver(classes, selectors) {

    if (selectors) {
      selectors.forEach(selector => {
        if (document.querySelector(selector)) {
            document.querySelector(selector).outerHTML = "";
        }
      });
    }

    return new MutationObserver((mutations, instance) => {
      instance.disconnect();
      allowOverflow(classes);

      for (let i = mutations.length; i--;) {
        const mutation = mutations[i];

        for (let j = mutation.addedNodes.length; j--;) {
          const node = mutation.addedNodes[j];
          const valid = (node instanceof HTMLElement) && (node.parentElement) && (!["BODY", "HTML"].includes(node.tagName));

          if (!valid) {
            continue;
          }

          if (node.matches(selectors)) {
            node.outerHTML = "";
          }
        }
      }

      instance.observe(target, options);
    });
  }

  const allowOverflow = (classes) => {
    const body = document.body;
    const facebook = document.getElementsByClassName("_31e")[0];
    const html = document.documentElement;

    if (body && classes.length > 0) {
      body.classList.remove(...classes);
    }
    if (body) {
      body.style.setProperty("overflow-y", "unset", "important");
    }
    if (facebook) {
      facebook.style.setProperty("position", "unset", "important");
    }
    if (html) {
      html.style.setProperty("overflow-y", "unset", "important");
    }
  };

  const host = `http://127.0.0.1:${port}/modaless`;
  const classesURL = `${host}/classes`;
  const selectorsURL = `${host}/selectors`;

  const selectors = await get(selectorsURL);
  const classes = (await get(classesURL)).map(clazz => clazz.trim());

  const observer = buildObserver(classes, selectors);
  observer.observe(target, options);
})
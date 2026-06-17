/* admin.nav-search.js - 側欄功能搜尋
   即時過濾所有 nav-link：命中的群組自動展開，無命中的群組隱藏，完全沒命中時顯示提示。 */
(function () {
  function setupNavSearch() {
    const sidebar = document.querySelector(".sidebar-nav");
    const wrap = document.getElementById("nav-search");
    const input = document.getElementById("nav-search-input");
    const clearBtn = document.getElementById("nav-search-clear");
    if (!sidebar || !wrap || !input) return;

    const groups = [...sidebar.querySelectorAll(".nav-group")];
    const normalize = (value) => (value || "").toLowerCase().replace(/\s+/g, "");

    function reset() {
      sidebar.classList.remove("is-searching", "no-results");
      for (const group of groups) {
        group.classList.remove("nav-group-empty");
        for (const link of group.querySelectorAll(".nav-link")) {
          link.classList.remove("nav-hidden");
        }
      }
    }

    function apply() {
      const keyword = normalize(input.value);
      wrap.classList.toggle("has-value", input.value.trim().length > 0);

      if (!keyword) {
        reset();
        return;
      }

      sidebar.classList.add("is-searching");
      let totalHits = 0;
      for (const group of groups) {
        let groupHits = 0;
        for (const link of group.querySelectorAll(".nav-link")) {
          // 本來就隱藏的功能（例如停用的放置掛機區）不納入搜尋
          if (link.hasAttribute("hidden")) {
            link.classList.add("nav-hidden");
            continue;
          }
          const match = normalize(link.textContent).includes(keyword);
          link.classList.toggle("nav-hidden", !match);
          if (match) groupHits += 1;
        }
        group.classList.toggle("nav-group-empty", groupHits === 0);
        totalHits += groupHits;
      }
      sidebar.classList.toggle("no-results", totalHits === 0);
    }

    function firstVisibleLink() {
      return groups
        .flatMap((group) => [...group.querySelectorAll(".nav-link")])
        .find((link) => !link.classList.contains("nav-hidden") && !link.hasAttribute("hidden"));
    }

    input.addEventListener("input", apply);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        input.value = "";
        apply();
        input.blur();
      } else if (event.key === "Enter") {
        const hit = firstVisibleLink();
        if (hit) hit.click();
      }
    });
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        input.value = "";
        apply();
        input.focus();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupNavSearch);
  } else {
    setupNavSearch();
  }
})();

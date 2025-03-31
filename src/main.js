class Cache {
  constructor() {
    this.data = new Map();
    this.translations = null;
    this.lastUpdate = 0;
    this.updateInterval = 60000; // 1 хвилина
  }

  set(key, value) {
    this.data.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  get(key) {
    const item = this.data.get(key);
    if (!item) return null;
    
    if (Date.now() - item.timestamp > this.updateInterval) {
      this.data.delete(key);
      return null;
    }
    
    return item.value;
  }
}

// Клас для роботи з перекладами
class TranslationManager {
  constructor() {
    this.cache = new Cache();
    this.debug = true;
  }

  async initialize() {
    try {
      const response = await fetch(chrome.runtime.getURL("src/locales/uk.json"));
      this.cache.translations = await response.json();
      this.log('Translations loaded:', Object.keys(this.cache.translations).length, 'items');
    } catch (error) {
      this.log('Failed to load translations:', error);
    }
  }

  translate(text, params = {}) {
    if (!text || !this.cache.translations) return text;

    // Перевіряємо чи текст містить ім'я користувача
    const match = text.match(/^(.*?),\s*([^!]+)(!?.*)$/);
    if (match) {
      const [_, prefix, name, suffix] = match;
      
      // Шукаємо переклад для шаблону
      const template = prefix + ", {displayName}" + suffix;
      const translation = this.cache.translations[template];
      
      if (translation) {
        // Підставляємо ім'я в переклад
        return translation.replace("{displayName}", name);
      }
    }

    // Якщо це не шаблон з ім'ям, шукаємо звичайний переклад
    return this.cache.translations[text] || text;
  }

  log(...args) {
    if (this.debug) {
      console.log('[TwitchUA]', ...args);
    }
  }
}

// Допоміжні функції
function escapeRegExp(string) {
  return string.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}

// Головний клас розширення
class TwitchUA {
  constructor() {
    this.translator = new TranslationManager();
    this.observer = null;
    this.processedElements = new WeakSet();
    this.ignoredTags = new Set(['SCRIPT', 'STYLE', 'META', 'LINK']);
    this.isEnabled = true;
  }

  async initialize() {
    try {
      console.log('[TwitchUA] Initializing...');
      
      // Load translations
      await this.translator.initialize();
      
      // Start observer and process page
      this.startObserver();
      this.processPage();
      
      console.log('[TwitchUA] Initialized successfully');
    } catch (error) {
      console.error('[TwitchUA] Initialization failed:', error);
      throw error;
    }
  }

  startObserver() {
    this.observer = new MutationObserver(mutations => {
      if (!this.isEnabled) return;
      
      mutations.forEach(mutation => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) {
              this.processElement(node);
              this.processChildElements(node);
            }
          });
        } else if (mutation.type === 'characterData') {
          const element = mutation.target.parentElement;
          if (element) {
            this.processElement(element);
          }
        }
      });
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  processPage() {
    if (!this.isEnabled) return;
    this.processImportantElements();
    this.processChildElements(document.body);
  }

  processImportantElements() {
    const selectors = [
      '.bits-chip__text',
      '.bits-card__text',
      '[data-test-selector="bits-balance"]',
      '.top-nav__menu',
      '.tw-button__text',
      '.tw-input',  
      'input[placeholder]',
      '.CoreText-sc-1txzju1-0',
      '.ScTitleText-sc-d9mj2s-0',
      '.Layout-sc-1xcs6mc-0.fAVISI p',
      '.Layout-sc-1xcs6mc-0 .CoreText-sc-1txzju1-0'
    ];

    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(element => {
        this.translateElement(element);
      });
    });
  }

  processElement(element) {
    if (!element || this.processedElements.has(element)) return;
    if (this.ignoredTags.has(element.tagName)) return;
    
    this.translateElement(element);
    this.processedElements.add(element);
  }

  processChildElements(parent) {
    if (!parent) return;
    
    const walker = document.createTreeWalker(
      parent,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          return !this.ignoredTags.has(node.tagName) 
            ? NodeFilter.FILTER_ACCEPT 
            : NodeFilter.FILTER_REJECT;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      this.processElement(node);
    }
  }

  translateElement(element) {
    this.translateAttributes(element);

    const text = element.textContent?.trim();
    if (!text) return;

    // Якщо елемент містить HTML (посилання тощо)
    if (element.innerHTML.includes('<a') || element.innerHTML.includes('<br>')) {
      const originalHTML = element.innerHTML;
      const translated = this.translator.translate(originalHTML);
      if (translated !== originalHTML) {
        this.translator.log('Translating HTML:', originalHTML, '→', translated);
        element.innerHTML = translated;
      }
      return;
    }

    // Для звичайного тексту
    if (element.childNodes.length === 1 && element.childNodes[0].nodeType === 3) {
      const translated = this.translator.translate(text);
      if (translated !== text) {
        this.translator.log('Translating text:', text, '→', translated);
        element.textContent = translated;
      }
    } else {
      const textNodes = Array.from(element.childNodes)
        .filter(node => node.nodeType === 3);

      textNodes.forEach(node => {
        const nodeText = node.textContent.trim();
        if (nodeText) {
          const translated = this.translator.translate(nodeText);
          if (translated !== nodeText) {
            this.translator.log('Translating node:', nodeText, '→', translated);
            node.textContent = translated;
          }
        }
      });
    }
  }

  translateAttributes(element) {
    const translatableAttributes = ['placeholder', 'title', 'alt', 'aria-label'];
    
    translatableAttributes.forEach(attr => {
      if (element.hasAttribute(attr)) {
        const originalValue = element.getAttribute(attr);
        if (originalValue) {
          const translated = this.translator.translate(originalValue);
          if (translated !== originalValue) {
            this.translator.log('Translating attribute:', attr, originalValue, '→', translated);
            element.setAttribute(attr, translated);
          }
        }
      }
    });
  }
}

// Ініціалізація розширення
console.log('[TwitchUA] Starting...');
const twitch = new TwitchUA();
twitch.initialize().catch(error => {
  console.error('[TwitchUA] Failed to start:', error);
});

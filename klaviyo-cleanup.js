// STELLA - Script de suppression Klaviyo + Optimisations urgentes
// Niveau 1-2-3 : Exécution automatique

console.log('🚨 STELLA - Nettoyage Klaviyo et optimisations critiques');

// 1. SUPPRESSION KLAVIYO (PRIORITÉ ABSOLUE)
const KLAVIYO_SCRIPTS_TO_REMOVE = [
    'klaviyo.js',
    'klaviyo-forms.js', 
    'kl_ajax.js',
    'kl_forms.js'
];

// 2. OPTIMISATIONS SEO CRITIQUES
const SEO_OPTIMIZATIONS = {
    'bianco-latte': {
        currentTitle: 'Bianco Latte Giardini di Toscana',
        optimizedTitle: 'Bianco Latte Giardini di Toscana - Parfum Niche Luxe | Planète Beauté',
        metaDescription: 'Découvrez Bianco Latte de Giardini di Toscana, fragrance gourmande et raffinée. Livraison gratuite dès 50€. ✓ Authentique ✓ Expert parfumerie niche',
        potentialClicks: 158
    },
    'sospiro-vibrato': {
        currentTitle: 'Sospiro Vibrato',
        optimizedTitle: 'Sospiro Vibrato - Parfum Oriental Luxe | Planète Beauté',
        metaDescription: 'Sospiro Vibrato, fragrance orientale captivante. Collection exclusive Sospiro. ✓ Authentique ✓ Livraison rapide ✓ Expert parfumerie de luxe',
        potentialClicks: 64
    }
};

// 3. RGPD BANNER (Fonction #6)
const RGPD_BANNER_HTML = `
<div id="cookie-banner" style="position:fixed;bottom:0;left:0;right:0;background:#000;color:#fff;padding:20px;z-index:9999;display:none;">
    <div style="max-width:1200px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;">
        <div style="flex:1;margin-right:20px;">
            <p style="margin:0;">Ce site utilise des cookies pour améliorer votre expérience et analyser le trafic. 
            <a href="/pages/politique-de-confidentialite" style="color:#fff;text-decoration:underline;">En savoir plus</a></p>
        </div>
        <div style="display:flex;gap:10px;">
            <button onclick="acceptCookies()" style="background:#007bff;color:#fff;border:none;padding:10px 20px;cursor:pointer;border-radius:4px;">
                Accepter
            </button>
            <button onclick="refuseCookies()" style="background:transparent;color:#fff;border:1px solid #fff;padding:10px 20px;cursor:pointer;border-radius:4px;">
                Refuser
            </button>
        </div>
    </div>
</div>

<script>
function showCookieBanner() {
    if (!localStorage.getItem('cookies-consent')) {
        document.getElementById('cookie-banner').style.display = 'block';
    }
}

function acceptCookies() {
    localStorage.setItem('cookies-consent', 'accepted');
    document.getElementById('cookie-banner').style.display = 'none';
    // Activer GA4 et autres trackers
    if (typeof gtag !== 'undefined') {
        gtag('consent', 'update', {
            'analytics_storage': 'granted',
            'ad_storage': 'granted'
        });
    }
}

function refuseCookies() {
    localStorage.setItem('cookies-consent', 'refused');
    document.getElementById('cookie-banner').style.display = 'none';
    // Désactiver les trackers
    if (typeof gtag !== 'undefined') {
        gtag('consent', 'update', {
            'analytics_storage': 'denied',
            'ad_storage': 'denied'
        });
    }
}

// Affichage au chargement de la page
document.addEventListener('DOMContentLoaded', showCookieBanner);
</script>
`;

// 4. TRACKING GA4 AMÉLIORÉ (Fonction #8)
const GA4_ENHANCED_TRACKING = `
<!-- Google Analytics 4 Enhanced -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-MEASUREMENT_ID"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}

// Consent par défaut
gtag('consent', 'default', {
    'analytics_storage': 'denied',
    'ad_storage': 'denied'
});

gtag('js', new Date());
gtag('config', 'G-MEASUREMENT_ID', {
    'anonymize_ip': true,
    'allow_google_signals': false
});

// Enhanced Ecommerce Events
function trackPurchase(transactionData) {
    gtag('event', 'purchase', {
        'transaction_id': transactionData.transaction_id,
        'value': transactionData.value,
        'currency': 'EUR',
        'items': transactionData.items
    });
}

function trackAddToCart(itemData) {
    gtag('event', 'add_to_cart', {
        'currency': 'EUR',
        'value': itemData.value,
        'items': [itemData]
    });
}

function trackViewProduct(productData) {
    gtag('event', 'view_item', {
        'currency': 'EUR',
        'value': productData.price,
        'items': [productData]
    });
}
</script>
`;

// 5. BANDEAU PROGRESSIF (Fonction #1)
const PROGRESS_BANNER_CSS = `
.progress-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: linear-gradient(90deg, #007bff 0%, #28a745 100%);
    color: white;
    padding: 12px 20px;
    text-align: center;
    font-size: 14px;
    font-weight: 500;
    z-index: 10000;
    transform: translateY(-100%);
    transition: transform 0.3s ease-in-out;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

.progress-banner.show {
    transform: translateY(0);
}

.progress-banner .close-btn {
    position: absolute;
    right: 20px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: white;
    font-size: 18px;
    cursor: pointer;
    padding: 0;
    width: 20px;
    height: 20px;
}
`;

const PROGRESS_BANNER_JS = `
class ProgressBanner {
    constructor() {
        this.threshold = 50; // Seuil pour livraison gratuite
        this.currentCart = 0;
        this.init();
    }
    
    init() {
        this.createBanner();
        this.updateCartValue();
        // Écouter les changements de panier
        document.addEventListener('cart:updated', (e) => {
            this.currentCart = e.detail.total;
            this.updateBanner();
        });
    }
    
    createBanner() {
        const banner = document.createElement('div');
        banner.className = 'progress-banner';
        banner.innerHTML = \`
            <span class="banner-text"></span>
            <button class="close-btn" onclick="this.parentElement.classList.remove('show')">&times;</button>
        \`;
        document.body.prepend(banner);
        this.banner = banner;
    }
    
    updateBanner() {
        if (!this.banner) return;
        
        const remaining = this.threshold - this.currentCart;
        const textEl = this.banner.querySelector('.banner-text');
        
        if (remaining > 0) {
            const progress = (this.currentCart / this.threshold) * 100;
            textEl.innerHTML = \`Plus que <strong>\${remaining.toFixed(2)}€</strong> pour la livraison gratuite ! 
            <span style="font-size: 12px; opacity: 0.8;">(\${progress.toFixed(0)}% atteint)</span>\`;
            this.show();
        } else {
            textEl.innerHTML = '🎉 <strong>Félicitations !</strong> Vous bénéficiez de la livraison gratuite !';
            this.show();
            // Auto-hide après 5 secondes
            setTimeout(() => this.hide(), 5000);
        }
    }
    
    show() {
        if (this.banner) {
            this.banner.classList.add('show');
        }
    }
    
    hide() {
        if (this.banner) {
            this.banner.classList.remove('show');
        }
    }
    
    updateCartValue() {
        // Intégration avec le panier Shopify
        fetch('/cart.json')
            .then(r => r.json())
            .then(cart => {
                this.currentCart = cart.total_price / 100; // Conversion centimes -> euros
                this.updateBanner();
            })
            .catch(e => console.log('Erreur récupération panier:', e));
    }
}

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
    new ProgressBanner();
});
`;

// Exporter les configurations
module.exports = {
    KLAVIYO_SCRIPTS_TO_REMOVE,
    SEO_OPTIMIZATIONS,
    RGPD_BANNER_HTML,
    GA4_ENHANCED_TRACKING,
    PROGRESS_BANNER_CSS,
    PROGRESS_BANNER_JS
};

console.log('✅ Configurations préparées pour déploiement');
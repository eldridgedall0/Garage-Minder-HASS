/**
 * Garage Maintenance - Mobile Navigation Drawer
 * Full-screen slide-out navigation for mobile devices
 * Includes: Navigation, Vehicle Picker, User Menu
 * 
 * Updated: Now displays actual membership level name from WordPress
 */

(function() {
    'use strict';

    // Breakpoint for mobile drawer (matches CSS)
    const MOBILE_BREAKPOINT = 768;
    
    // Drawer state
    let isDrawerOpen = false;
    let touchStartX = 0;
    let touchStartY = 0;
    let isSwiping = false;

    /**
     * Initialize mobile navigation
     */
    function initMobileNav() {
        // Only initialize if we haven't already
        if (document.getElementById('mobile-nav-drawer')) {
            return;
        }

        createDrawerElements();
        bindEvents();
        handleResize();
        
        // Listen for window resize
        window.addEventListener('resize', debounce(handleResize, 150));
    }

    /**
     * Create drawer HTML elements
     */
    function createDrawerElements() {
        // Create hamburger button
        const hamburger = document.createElement('button');
        hamburger.id = 'mobile-nav-hamburger';
        hamburger.className = 'mobile-nav-hamburger';
        hamburger.setAttribute('aria-label', 'Open navigation menu');
        hamburger.setAttribute('aria-expanded', 'false');
        hamburger.innerHTML = `
            <span class="hamburger-line"></span>
            <span class="hamburger-line"></span>
            <span class="hamburger-line"></span>
        `;

        // Create backdrop
        const backdrop = document.createElement('div');
        backdrop.id = 'mobile-nav-backdrop';
        backdrop.className = 'mobile-nav-backdrop';

        // Create drawer
        const drawer = document.createElement('div');
        drawer.id = 'mobile-nav-drawer';
        drawer.className = 'mobile-nav-drawer';
        drawer.setAttribute('aria-hidden', 'true');

        // Drawer content will be rendered dynamically
        drawer.innerHTML = `
            <div class="drawer-header">
                <div class="drawer-brand">
                    <img src="assets/images/icon-64.png" alt="" class="drawer-logo">
                    <div class="drawer-titles">
                        <span class="drawer-app-name">TrackMyWrench</span>
                        <span id="drawer-site-title" class="drawer-site-title"></span>
                    </div>
                </div>
                <button type="button" class="drawer-close" aria-label="Close navigation menu">
                    <span>×</span>
                </button>
            </div>
            <div class="drawer-scroll-content">
                <nav class="drawer-nav" role="navigation">
                    <button class="drawer-nav-item" data-view="dashboard">
                        <span class="drawer-nav-icon">📊</span>
                        <span class="drawer-nav-label">Dashboard</span>
                    </button>
                    <button class="drawer-nav-item" data-view="reminders">
                        <span class="drawer-nav-icon">🔔</span>
                        <span class="drawer-nav-label">Reminders</span>
                    </button>
                    <button class="drawer-nav-item" data-view="settings">
                        <span class="drawer-nav-icon">⚙️</span>
                        <span class="drawer-nav-label">Settings</span>
                    </button>
                </nav>
                <div class="drawer-divider"></div>
                <div class="drawer-vehicle-section">
                    <div class="drawer-section-title">Vehicle</div>
                    <div id="drawer-vehicle-picker" class="drawer-vehicle-picker">
                        <!-- Vehicle picker rendered here -->
                    </div>
                    <div id="drawer-vehicle-odo" class="drawer-vehicle-odo">
                        <!-- Odometer update rendered here -->
                    </div>
                </div>
                <div class="drawer-spacer"></div>
                <div id="drawer-user-section" class="drawer-user-section">
                    <!-- User menu rendered here (multi-user only) -->
                </div>
                <div class="drawer-footer">
                    <span>© 2025 Garage Maintenance</span>
                </div>
            </div>
        `;

        // Insert elements into DOM
        const header = document.querySelector('header');
        const topControls = document.querySelector('.top-controls');
        
        if (header && topControls) {
            // Insert hamburger before top-controls
            topControls.insertBefore(hamburger, topControls.firstChild);
        }

        document.body.appendChild(backdrop);
        document.body.appendChild(drawer);
    }

    /**
     * Bind event listeners
     */
    function bindEvents() {
        const hamburger = document.getElementById('mobile-nav-hamburger');
        const backdrop = document.getElementById('mobile-nav-backdrop');
        const drawer = document.getElementById('mobile-nav-drawer');
        const closeBtn = drawer?.querySelector('.drawer-close');

        // Hamburger click
        hamburger?.addEventListener('click', openDrawer);

        // Close button click
        closeBtn?.addEventListener('click', closeDrawer);

        // Backdrop click
        backdrop?.addEventListener('click', closeDrawer);

        // Navigation item clicks
        drawer?.querySelectorAll('.drawer-nav-item').forEach(item => {
            item.addEventListener('click', handleNavClick);
        });

        // Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isDrawerOpen) {
                closeDrawer();
            }
        });

        // Touch events for swipe-to-close
        drawer?.addEventListener('touchstart', handleTouchStart, { passive: true });
        drawer?.addEventListener('touchmove', handleTouchMove, { passive: false });
        drawer?.addEventListener('touchend', handleTouchEnd, { passive: true });

        // Vehicle picker change (delegated)
        drawer?.addEventListener('change', (e) => {
            if (e.target.id === 'drawer-vehicle-select') {
                handleVehicleChange(e);
            }
        });

        // Odometer update button (delegated)
        drawer?.addEventListener('click', (e) => {
            if (e.target.id === 'drawer-odo-update' || e.target.closest('#drawer-odo-update')) {
                handleOdometerUpdate();
            }
        });

        // Odometer input enter key
        drawer?.addEventListener('keypress', (e) => {
            if (e.target.id === 'drawer-odo-input' && e.key === 'Enter') {
                e.preventDefault();
                handleOdometerUpdate();
            }
        });
    }

    /**
     * Handle window resize
     */
    function handleResize() {
        const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
        const hamburger = document.getElementById('mobile-nav-hamburger');
        const desktopNav = document.querySelector('.nav');
        const vehiclePicker = document.getElementById('vehicle-picker');

        if (hamburger) {
            hamburger.style.display = isMobile ? 'flex' : 'none';
        }

        if (desktopNav) {
            desktopNav.classList.toggle('desktop-only', isMobile);
        }

        if (vehiclePicker) {
            vehiclePicker.classList.toggle('desktop-only', isMobile);
        }

        // Close drawer if switching to desktop
        if (!isMobile && isDrawerOpen) {
            closeDrawer(false); // Don't animate
        }

        // Don't update drawer content if an input inside the drawer is focused
        // This prevents the keyboard from closing when it opens on mobile
        const activeElement = document.activeElement;
        const isDrawerInputFocused = activeElement && 
            activeElement.closest('#mobile-nav-drawer') && 
            (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SELECT');
        
        if (isDrawerInputFocused) {
            return; // Don't re-render while user is typing
        }

        // Update drawer content when visible (but not when input is focused)
        if (isMobile && isDrawerOpen) {
            updateDrawerContent();
        }
    }

    /**
     * Open the drawer
     */
    function openDrawer() {
        const drawer = document.getElementById('mobile-nav-drawer');
        const backdrop = document.getElementById('mobile-nav-backdrop');
        const hamburger = document.getElementById('mobile-nav-hamburger');

        if (!drawer || !backdrop) return;

        isDrawerOpen = true;
        
        // Update content before showing
        updateDrawerContent();

        // Show elements
        backdrop.classList.add('visible');
        drawer.classList.add('open');
        drawer.setAttribute('aria-hidden', 'false');
        hamburger?.setAttribute('aria-expanded', 'true');

        // Prevent body scroll
        document.body.style.overflow = 'hidden';

        // Focus management
        const firstFocusable = drawer.querySelector('.drawer-close');
        firstFocusable?.focus();
    }

    /**
     * Close the drawer
     */
    function closeDrawer(animate = true) {
        const drawer = document.getElementById('mobile-nav-drawer');
        const backdrop = document.getElementById('mobile-nav-backdrop');
        const hamburger = document.getElementById('mobile-nav-hamburger');

        if (!drawer || !backdrop) return;

        isDrawerOpen = false;

        // Hide elements
        backdrop.classList.remove('visible');
        drawer.classList.remove('open');
        drawer.setAttribute('aria-hidden', 'true');
        hamburger?.setAttribute('aria-expanded', 'false');

        // Restore body scroll
        document.body.style.overflow = '';

        // Return focus to hamburger
        hamburger?.focus();
    }

    /**
     * Handle navigation item click
     */
    function handleNavClick(e) {
        const view = e.currentTarget.dataset.view;
        if (!view) return;

        // Use router for navigation (updates URL + renders view)
        if (typeof navigateTo === 'function') {
            navigateTo(view);
            closeDrawer();
        } else {
            // Fallback if router not loaded
            // Update desktop nav buttons state
            document.querySelectorAll('.nav-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.view === view);
            });

            // Update drawer nav items state
            document.querySelectorAll('.drawer-nav-item').forEach(item => {
                item.classList.toggle('active', item.dataset.view === view);
            });

            // Switch view
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            const targetView = document.getElementById('view-' + view);
            if (targetView) {
                targetView.classList.add('active');
            }

            // Trigger view-specific rendering
            if (view === 'dashboard' && typeof renderDashboard === 'function') {
                renderDashboard();
            } else if (view === 'reminders' && typeof renderRemindersPage === 'function') {
                renderRemindersPage();
            } else if (view === 'settings' && typeof renderSettings === 'function') {
                renderSettings();
            }

            // Close drawer
            closeDrawer();
        }
    }

    /**
     * Handle vehicle selection change
     */
    function handleVehicleChange(e) {
        const selectedValue = e.target.value;
        
        // Update main vehicle picker
        const mainPicker = document.getElementById('active-vehicle');
        if (mainPicker) {
            mainPicker.value = selectedValue;
        }

        // Update state
        if (typeof setActiveVehicle === 'function') {
            window.dashboardHistoryPage = 1;
            setActiveVehicle(selectedValue);
        }

        // Use router to navigate with new vehicle context
        if (typeof navigateTo === 'function' && typeof getCurrentRoute === 'function') {
            const currentRoute = getCurrentRoute();
            navigateTo(currentRoute.view, selectedValue, currentRoute.subview);
        } else {
            // Fallback if router not loaded
            if (typeof renderDashboard === 'function') renderDashboard();
            if (typeof renderRemindersPage === 'function') renderRemindersPage();
            
            // Update safety status for specific vehicles
            if (selectedValue && selectedValue !== 'all' && typeof updateSafetyStatus === 'function') {
                updateSafetyStatus();
            }
        }
        
        // Update drawer odometer section
        updateDrawerVehicleOdo();
    }

    /**
     * Handle odometer update
     */
    function handleOdometerUpdate() {
        if (typeof activeVehicleId === 'undefined' || !activeVehicleId || activeVehicleId === 'all') return;

        const input = document.getElementById('drawer-odo-input');
        if (!input) return;

        const newOdo = input.value;
        const odoValue = newOdo !== '' ? Number(newOdo) : null;

        if (odoValue !== null && odoValue < 0) {
            alert('Odometer cannot be negative.');
            return;
        }

        const v = data.vehicles.find(v => v.id === activeVehicleId);
        if (!v) return;

        if (v.currentOdo === odoValue) {
            if (typeof showToast === 'function') showToast('No change in odometer');
            return;
        }

        v.currentOdo = odoValue;
        if (typeof saveData === 'function') saveData();

        // Update all relevant displays
        if (typeof renderVehiclePicker === 'function') renderVehiclePicker();
        if (typeof renderDashboardRemindersSnippet === 'function') renderDashboardRemindersSnippet();
        if (typeof renderRemindersPage === 'function') renderRemindersPage();
        
        // Update drawer
        updateDrawerVehicleOdo();

        if (typeof showToast === 'function') {
            showToast(`Odometer updated to ${odoValue !== null ? odoValue.toLocaleString() : '—'}`);
        }
    }

    /**
     * Update drawer content
     */
    function updateDrawerContent() {
        updateDrawerSiteTitle();
        updateDrawerNavState();
        updateDrawerVehiclePicker();
        updateDrawerVehicleOdo();
        updateDrawerUserSection();
    }

    /**
     * Update drawer site title
     */
    function updateDrawerSiteTitle() {
        const titleEl = document.getElementById('drawer-site-title');
        if (!titleEl) return;

        const title = data?.settings?.siteTitle || '';
        if (title && title !== 'MyWrench.app' && title !== 'Garage Maintenance') {
            titleEl.textContent = title;
            titleEl.style.display = '';
        } else {
            titleEl.textContent = '';
            titleEl.style.display = 'none';
        }
    }

    /**
     * Update drawer navigation active state
     */
    function updateDrawerNavState() {
        const activeNavBtn = document.querySelector('.nav-btn.active');
        const activeView = activeNavBtn?.dataset.view || 'dashboard';

        document.querySelectorAll('.drawer-nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === activeView);
        });
    }

    /**
     * Update drawer vehicle picker
     */
    function updateDrawerVehiclePicker() {
        const container = document.getElementById('drawer-vehicle-picker');
        if (!container) return;

        const vehicles = data?.vehicles || [];
        const currentVehicle = typeof activeVehicleId !== 'undefined' ? activeVehicleId : 'all';

        let html = '<select id="drawer-vehicle-select" class="drawer-vehicle-select">';
        html += '<option value="all"' + (currentVehicle === 'all' ? ' selected' : '') + '>🚗 All Vehicles</option>';
        
        vehicles.forEach(v => {
            const selected = currentVehicle === v.id ? ' selected' : '';
            html += `<option value="${v.id}"${selected}>${escapeHtml(v.name)}</option>`;
        });
        
        html += '</select>';

        container.innerHTML = html;
    }

    /**
     * Update drawer odometer section
     */
    function updateDrawerVehicleOdo() {
        const container = document.getElementById('drawer-vehicle-odo');
        if (!container) return;

        const currentVehicle = typeof activeVehicleId !== 'undefined' ? activeVehicleId : 'all';

        if (!currentVehicle || currentVehicle === 'all') {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }

        const v = data?.vehicles?.find(veh => veh.id === currentVehicle);
        if (!v) {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }

        container.style.display = '';
        const unit = typeof getUnitShort === 'function' ? getUnitShort() : 'mi';
        const currentOdo = v.currentOdo != null ? v.currentOdo : '';

        container.innerHTML = `
            <div class="drawer-odo-row">
                <label for="drawer-odo-input" class="drawer-odo-label">Current odometer:</label>
                <div class="drawer-odo-input-group">
                    <div class="drawer-odo-input-row">
                        <input type="number" 
                               id="drawer-odo-input" 
                               class="drawer-odo-input" 
                               value="${currentOdo}" 
                               min="0" 
                               step="1" 
                               placeholder="0"
                               inputmode="numeric">
                        <span class="drawer-odo-unit">${unit}</span>
                    </div>
                    <button type="button" id="drawer-odo-update" class="drawer-odo-btn">Update Odometer</button>
                </div>
            </div>
        `;
    }

    /**
     * Get subscription badge info for mobile drawer
     * Uses the actual membership level name from WordPress
     * 
     * @param {Object} user - Current user object with subscription data
     * @returns {Object} { text: string, cssClass: string }
     */
    function getDrawerBadgeInfo(user) {
        if (!user) {
            return { text: 'Free Account', cssClass: 'free' };
        }

        const hasSubscription = user.has_subscription;
        const levelName = user.subscription_level_name || null;
        const tier = user.subscription_tier || 'free';

        // If we have an actual level name from WordPress, use it
        if (levelName) {
            if (hasSubscription) {
                return { text: `✓ ${levelName} Account`, cssClass: 'pro' };
            }
            return { text: `${levelName} Account`, cssClass: 'free' };
        }

        // Fallback to tier-based display
        if (hasSubscription) {
            switch (tier) {
                case 'fleet':
                    return { text: '✓ Fleet Account', cssClass: 'pro fleet' };
                case 'paid':
                    return { text: '✓ Pro Account', cssClass: 'pro' };
                default:
                    return { text: '✓ Pro Account', cssClass: 'pro' };
            }
        }

        return { text: 'Free Account', cssClass: 'free' };
    }

    /**
     * Update drawer user section (multi-user only)
     * Updated: Now uses actual membership level name from WordPress
     */
    function updateDrawerUserSection() {
        const container = document.getElementById('drawer-user-section');
        if (!container) return;

        // Check if multi-user is enabled
        const multiUserEnabled = data?.multiUserEnabled || false;
        const user = data?.user || null;
        const authUrls = data?.authUrls || {};

        if (!multiUserEnabled) {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }

        container.style.display = '';

        if (user && user.id) {
            const displayName = user.display_name || user.email || 'User';
            const initials = getInitials(displayName);
            const hasSubscription = user.has_subscription;
            
            // Get dynamic badge info using actual membership level name
            const badgeInfo = getDrawerBadgeInfo(user);

            container.innerHTML = `
                <div class="drawer-divider"></div>
                <div class="drawer-user-info">
                    <div class="drawer-user-avatar">${escapeHtml(initials)}</div>
                    <div class="drawer-user-details">
                        <div class="drawer-user-name">${escapeHtml(displayName)}</div>
                        <div class="drawer-user-email">${escapeHtml(user.email || '')}</div>
                        <div class="drawer-user-badge ${badgeInfo.cssClass}">${escapeHtml(badgeInfo.text)}</div>
                    </div>
                </div>
                <div class="drawer-user-actions">
                    <a href="${authUrls.profile_url || '/wp-admin/profile.php'}" class="drawer-user-link">
                        👤 My Profile
                    </a>
                    ${!hasSubscription ? `
                    <a href="${authUrls.subscribe_url || '/subscribe/'}" class="drawer-user-link upgrade">
                        ⭐ Upgrade
                    </a>
                    ` : ''}
                    <a href="${authUrls.logout_url || '/wp-login.php?action=logout'}" class="drawer-user-link logout">
                        🚪 Log Out
                    </a>
                </div>
            `;
        } else {
            container.innerHTML = `
                <div class="drawer-divider"></div>
                <a href="${authUrls.login_url || '/wp-login.php'}" class="drawer-login-btn">
                    🔐 Log In
                </a>
            `;
        }
    }

    /**
     * Touch handling for swipe-to-close
     */
    function handleTouchStart(e) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isSwiping = false;
    }

    function handleTouchMove(e) {
        if (!isDrawerOpen) return;

        const touchX = e.touches[0].clientX;
        const touchY = e.touches[0].clientY;
        const diffX = touchStartX - touchX;
        const diffY = Math.abs(touchStartY - touchY);

        // Only trigger swipe if horizontal movement is greater than vertical
        if (diffX > 30 && diffX > diffY) {
            isSwiping = true;
            e.preventDefault();
        }
    }

    function handleTouchEnd(e) {
        if (isSwiping) {
            closeDrawer();
        }
        isSwiping = false;
    }

    /**
     * Helper: Get initials from name
     */
    function getInitials(name) {
        if (!name) return '?';
        const parts = name.trim().split(/\s+/);
        if (parts.length === 1) {
            return parts[0].charAt(0).toUpperCase();
        }
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }

    /**
     * Helper: Escape HTML
     */
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Helper: Debounce function
     */
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Expose public API
    window.gmMobileNav = {
        init: initMobileNav,
        open: openDrawer,
        close: closeDrawer,
        update: updateDrawerContent,
        isOpen: () => isDrawerOpen
    };

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(initMobileNav, 50);
        });
    } else {
        setTimeout(initMobileNav, 50);
    }

})();

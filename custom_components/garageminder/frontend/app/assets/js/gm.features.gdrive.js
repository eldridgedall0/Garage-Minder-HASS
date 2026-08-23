/**
 * Garage Maintenance - Google Drive Integration
 * Handles Google Drive file attachment functionality
 */

// Google Drive connection state
let gdriveConnected = false;
let gdrivePickerApiLoaded = false;
let gdrivePickerOauthToken = null;
let gdriveClientId = null;
let gdriveAppId = null;

// Scope for Drive API
const GDRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/**
 * Initialize Google Drive integration
 */
async function initGoogleDrive() {
    // Check if Google Drive is enabled in config
    if (typeof GM_CONFIG === 'undefined' || !GM_CONFIG.googleDriveEnabled) {
        console.log('Google Drive integration not enabled');
        return;
    }
    
    // Check connection status
    try {
        const response = await fetch('google-drive-auth.php?action=status', {
            credentials: 'same-origin'
        });
        const result = await response.json();
        
        gdriveConnected = result.connected === true;
        
        if (gdriveConnected) {
            console.log('Google Drive connected');
            // Pre-load the picker API
            loadGooglePickerApi();
        }
    } catch (error) {
        console.error('Failed to check Google Drive status:', error);
    }
}

/**
 * Load Google Picker API
 */
function loadGooglePickerApi() {
    if (gdrivePickerApiLoaded) return;
    
    // Load Google API script
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = () => {
        gapi.load('picker', () => {
            gdrivePickerApiLoaded = true;
            console.log('Google Picker API loaded');
        });
    };
    document.head.appendChild(script);
}

/**
 * Check if user can use Google Drive attachments
 */
function canUseGoogleDrive() {
    return typeof GM_CONFIG !== 'undefined' && GM_CONFIG.googleDriveEnabled;
}

/**
 * Check if user can use local uploads (paid feature)
 */
function canUseLocalUpload() {
    // Check subscription tier
    if (typeof GM_USER !== 'undefined') {
        const tier = GM_USER.subscription_tier || 'free';
        return tier !== 'free';
    }
    return true; // Default allow in single-user mode
}

/**
 * Start Google Drive authorization flow
 */
function authorizeGoogleDrive(callback) {
    // Open auth popup
    const width = 600;
    const height = 700;
    const left = (screen.width - width) / 2;
    const top = (screen.height - height) / 2;
    
    const popup = window.open(
        'google-drive-auth.php?action=authorize',
        'google_auth',
        `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
    );
    
    // Listen for auth result
    const messageHandler = (event) => {
        if (event.data && event.data.type === 'google-drive-auth-success') {
            window.removeEventListener('message', messageHandler);
            gdriveConnected = true;
            loadGooglePickerApi();
            showToast('Google Drive connected successfully');
            if (callback) callback(true);
        } else if (event.data && event.data.type === 'google-drive-auth-error') {
            window.removeEventListener('message', messageHandler);
            showToast('Google Drive authorization failed: ' + (event.data.message || 'Unknown error'));
            if (callback) callback(false);
        }
    };
    
    window.addEventListener('message', messageHandler);
    
    // Cleanup if popup is closed without completing
    const checkClosed = setInterval(() => {
        if (popup && popup.closed) {
            clearInterval(checkClosed);
            window.removeEventListener('message', messageHandler);
        }
    }, 500);
}

/**
 * Open Google Drive Picker for file selection
 */
async function openGoogleDrivePicker(entryId, onFilesSelected) {
    console.log('openGoogleDrivePicker called, pickerApiLoaded:', gdrivePickerApiLoaded);
    
    if (!gdrivePickerApiLoaded) {
        showToast('Google Drive is loading... Please try again.');
        loadGooglePickerApi();
        return;
    }
    
    // Get fresh access token
    try {
        console.log('Fetching picker token...');
        const response = await fetch('google-drive-upload.php?action=picker_token', {
            credentials: 'same-origin'
        });
        const result = await response.json();
        console.log('Picker token response:', result);
        
        if (!result.success) {
            if (result.error === 'not_connected') {
                console.log('Not connected, starting auth flow. Debug info:', result.debug);
                // Need to authorize first
                authorizeGoogleDrive((success) => {
                    if (success) {
                        // Retry opening picker
                        openGoogleDrivePicker(entryId, onFilesSelected);
                    }
                });
                return;
            }
            throw new Error(result.message || 'Failed to get access token');
        }
        
        gdrivePickerOauthToken = result.access_token;
        gdriveClientId = result.client_id;
        gdriveAppId = result.app_id;
        console.log('Got access token, opening picker...');
        
    } catch (error) {
        console.error('Failed to get picker token:', error);
        showToast('Failed to connect to Google Drive. Please try again.');
        return;
    }
    
    // Get allowed MIME types from config
    const allowedMimes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp'
    ];
    
    // Create picker view
    const docsView = new google.picker.DocsView()
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false)
        .setMimeTypes(allowedMimes.join(','));
    
    // Build picker
    const origin = window.location.protocol + '//' + window.location.host;
    console.log('Picker origin:', origin);
    console.log('OAuth token (first 20 chars):', gdrivePickerOauthToken ? gdrivePickerOauthToken.substring(0, 20) + '...' : 'null');
    console.log('App ID:', gdriveAppId);
    
    // Create the callback function and store reference
    const callbackFn = function(data) {
        console.log('=== PICKER CALLBACK FIRED ===');
        console.log('Action:', data.action);
        console.log('Data:', data);
        
        if (data.action === google.picker.Action.PICKED) {
            const files = data.docs.map(doc => ({
                id: doc.id,
                name: doc.name,
                mimeType: doc.mimeType,
                size: doc.sizeBytes || 0,
                url: doc.url
            }));
            
            console.log('Files picked:', files);
            
            // Call the attachment function
            if (typeof attachGoogleDriveFiles === 'function') {
                attachGoogleDriveFiles(files, entryId);
            }
            
            showToast(`Selected ${files.length} file(s) from Google Drive`);
        } else if (data.action === google.picker.Action.CANCEL) {
            console.log('Picker cancelled');
        }
    };
    
    try {
        const pickerBuilder = new google.picker.PickerBuilder()
            .addView(docsView)
            .addView(new google.picker.DocsUploadView())
            .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
            .setOAuthToken(gdrivePickerOauthToken)
            .setOrigin(origin)
            .setCallback(callbackFn)
            .setTitle('Select files to attach');
        
        // Set App ID if available
        if (gdriveAppId) {
            pickerBuilder.setAppId(gdriveAppId);
        }
        
        const picker = pickerBuilder.build();
        console.log('Picker built successfully');
        picker.setVisible(true);
        console.log('Picker should now be visible');
    } catch (err) {
        console.error('Error building picker:', err);
        showToast('Error opening file picker: ' + err.message);
    }
}

/**
 * Attach selected Google Drive files to an entry
 * If entryId is null/empty, stores files for later attachment when entry is saved
 */
let pendingGoogleDriveFiles = []; // Temporary storage for files selected before entry exists

async function attachGoogleDriveFiles(files, entryId) {
    if (!files || !files.length) return;
    
    console.log('attachGoogleDriveFiles called with entryId:', entryId, 'files:', files);
    
    // If no entry ID, store files to attach after entry is created
    if (!entryId) {
        pendingGoogleDriveFiles = files;
        showToast(`${files.length} file(s) selected from Google Drive. Will attach when entry is saved.`);
        
        // Show the selected files in the UI
        displayPendingGoogleDriveFiles(files);
        return;
    }
    
    showToast('Attaching files from Google Drive...');
    
    try {
        const response = await fetch('google-drive-upload.php?action=attach', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                entry_id: entryId,
                files: files
            })
        });
        
        if (response.status === 401) {
            showToast('Session expired. Please log in again.');
            window.location.reload();
            return;
        }
        
        const result = await response.json();
        console.log('Attach result:', result);
        
        if (result.success) {
            showToast(`${result.count} file(s) attached from Google Drive`);
            
            // Update local data
            const entry = data.entries.find(e => e.id === entryId);
            if (entry) {
                if (!entry.attachments) entry.attachments = [];
                result.attached.forEach(att => {
                    entry.attachments.push(att);
                });
            }
            
            // Refresh the UI
            loadData();
            renderDashboard();
        } else {
            showToast('Failed to attach files: ' + (result.message || result.error || 'Unknown error'));
        }
        
        if (result.errors && result.errors.length) {
            console.warn('Attachment errors:', result.errors);
        }
    } catch (error) {
        console.error('Google Drive attach error:', error);
        showToast('Failed to attach files: ' + error.message);
    }
}

/**
 * Display pending Google Drive files in the new entry form
 */
function displayPendingGoogleDriveFiles(files) {
    const $preview = $('#selected-files-preview');
    if (!$preview.length) return;
    
    // Add to existing preview or create new
    let $list = $preview.find('.gdrive-pending-files');
    if (!$list.length) {
        $list = $('<div>').addClass('gdrive-pending-files').css({
            padding: '8px',
            background: 'var(--gm-bg-subtle)',
            borderRadius: '4px',
            marginTop: '4px'
        });
        $preview.append($list);
    }
    
    $list.empty();
    $list.append($('<div>').css({fontWeight: '500', marginBottom: '4px'}).html(
        `<i class="bi bi-google" style="color:#4285f4"></i> ${files.length} Google Drive file(s) selected:`
    ));
    
    files.forEach(file => {
        $list.append(
            $('<div>').css({color: 'var(--gm-text-secondary)', fontSize: '0.85rem'}).html(
                `<i class="bi bi-file-earmark"></i> ${file.name}`
            )
        );
    });
}

/**
 * Get and clear pending Google Drive files
 */
function getPendingGoogleDriveFiles() {
    const files = pendingGoogleDriveFiles;
    pendingGoogleDriveFiles = [];
    return files;
}

/**
 * Clear pending Google Drive files (e.g., when form is reset)
 */
function clearPendingGoogleDriveFiles() {
    pendingGoogleDriveFiles = [];
    $('#selected-files-preview .gdrive-pending-files').remove();
}

/**
 * Download/validate a Google Drive attachment
 */
async function downloadGoogleDriveAttachment(attachmentId, attachmentName) {
    showToast('Checking file availability...');
    
    try {
        const response = await fetch(`google-drive-validate.php?id=${encodeURIComponent(attachmentId)}&format=json`, {
            credentials: 'same-origin'
        });
        
        const result = await response.json();
        
        if (!result.success) {
            // File is unavailable
            showToast(result.message || 'File is no longer available');
            
            // Show a more detailed error dialog
            if (result.error === 'file_unavailable') {
                const shouldDelete = confirm(
                    `The file "${attachmentName}" is no longer available in Google Drive.\n\n` +
                    `It may have been deleted or sharing permissions changed.\n\n` +
                    `Would you like to remove this attachment from your records?`
                );
                
                if (shouldDelete) {
                    // Delete the attachment record
                    await deleteAttachment(attachmentId);
                }
            }
            return;
        }
        
        // File is accessible - open in new tab
        window.open(result.url, '_blank');
        
    } catch (error) {
        console.error('Download validation error:', error);
        showToast('Failed to access file');
    }
}

/**
 * Disconnect Google Drive
 */
async function disconnectGoogleDrive() {
    if (!confirm('Are you sure you want to disconnect Google Drive?\n\nExisting attachments will still be accessible, but you won\'t be able to add new files from Google Drive.')) {
        return;
    }
    
    try {
        const response = await fetch('google-drive-auth.php?action=revoke', {
            credentials: 'same-origin'
        });
        
        const result = await response.json();
        
        if (result.success) {
            gdriveConnected = false;
            gdrivePickerOauthToken = null;
            showToast('Google Drive disconnected');
            
            // Refresh settings UI if we're on settings page
            if (typeof renderSettingsPage === 'function') {
                renderSettingsPage();
            }
        } else {
            showToast('Failed to disconnect: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Disconnect error:', error);
        showToast('Failed to disconnect Google Drive');
    }
}

/**
 * Render attachment upload area with Google Drive option
 */
function renderAttachmentUploadArea(entryId, currentCount, maxCount) {
    const $container = $('<div>').addClass('attachment-upload-container');
    
    const canDrive = canUseGoogleDrive();
    const canLocal = canUseLocalUpload();
    const remainingSlots = Math.max(0, maxCount - currentCount);
    
    if (remainingSlots <= 0) {
        $container.append(
            $('<div>').addClass('attachment-limit-reached text-muted')
                .text(`Maximum ${maxCount} attachments reached`)
        );
        return $container;
    }
    
    // Google Drive button (available to all users)
    if (canDrive) {
        const $driveBtn = $('<button>')
            .addClass('btn-ghost btn-attachment-drive')
            .attr('type', 'button')
            .html('<i class="bi bi-google"></i> Add from Google Drive')
            .on('click', function(e) {
                e.preventDefault();
                openGoogleDrivePicker(entryId, attachGoogleDriveFiles);
            });
        
        $container.append($driveBtn);
    }
    
    // Local upload (paid users only)
    if (canLocal) {
        const $localInput = $('<input>')
            .attr({
                type: 'file',
                multiple: true,
                accept: ATTACH_ALLOWED_EXT.map(e => '.' + e).join(',')
            })
            .addClass('entry-attach-files')
            .css('display', 'none');
        
        const $localBtn = $('<button>')
            .addClass('btn-ghost btn-attachment-local')
            .attr('type', 'button')
            .html('<i class="bi bi-upload"></i> Upload File')
            .on('click', function(e) {
                e.preventDefault();
                $localInput.click();
            });
        
        $container.append($localBtn, $localInput);
    } else if (canDrive) {
        // Show upgrade hint for free users
        const $upgradeHint = $('<div>')
            .addClass('attachment-upgrade-hint text-muted')
            .html('<i class="bi bi-lock"></i> <a href="javascript:void(0)" class="upgrade-link">Upgrade</a> to upload files directly');
        
        $upgradeHint.find('.upgrade-link').on('click', function() {
            // Navigate to subscription page
            if (typeof GM_AUTH_URLS !== 'undefined' && GM_AUTH_URLS.subscribe_url) {
                window.location.href = GM_AUTH_URLS.subscribe_url;
            }
        });
        
        $container.append($upgradeHint);
    }
    
    // Show allowed file types
    const $hint = $('<div>')
        .addClass('attachment-hint text-muted')
        .text(`Allowed: ${ATTACH_ALLOWED_EXT.join(', ').toUpperCase()} (max ${typeof ATTACH_MAX_SIZE_MB !== 'undefined' ? ATTACH_MAX_SIZE_MB : 5}MB)`);
    
    $container.append($hint);
    
    return $container;
}

/**
 * Render attachment item with source indicator
 */
function renderAttachmentItem(att, showDelete = false, entryId = null) {
    const $item = $('<div>').addClass('attachment-item');
    
    // Source indicator
    const isGoogleDrive = att.source === 'google_drive';
    const sourceIcon = isGoogleDrive ? 'bi-google' : 'bi-file-earmark';
    const sourceClass = isGoogleDrive ? 'source-gdrive' : 'source-local';
    
    // File icon based on type
    let fileIcon = 'bi-file-earmark';
    const mime = (att.type || att.mime_type || '').toLowerCase();
    if (mime.includes('pdf')) fileIcon = 'bi-file-pdf';
    else if (mime.includes('image')) fileIcon = 'bi-file-image';
    else if (mime.includes('word') || mime.includes('document')) fileIcon = 'bi-file-word';
    
    const $preview = $('<div>').addClass('attachment-preview').append(
        $('<i>').addClass(`bi ${fileIcon} file-icon`)
    );
    
    const $meta = $('<div>').addClass('attachment-meta').append(
        $('<div>').addClass('attachment-name').append(
            $('<i>').addClass(`bi ${sourceIcon} source-icon ${sourceClass}`).attr('title', isGoogleDrive ? 'Google Drive' : 'Local file'),
            $('<span>').text(att.name || 'Attachment')
        ),
        att.size != null ? $('<div>').addClass('attachment-size text-muted').text(formatBytes(att.size)) : null
    );
    
    const $actions = $('<div>').addClass('attachment-actions');
    
    // Download button
    const $downloadBtn = $('<button>')
        .addClass('attachment-btn download')
        .attr('type', 'button')
        .html('<i class="bi bi-download"></i>')
        .attr('title', 'Download')
        .data('att-id', att.id)
        .data('att-name', att.name)
        .data('att-source', att.source || 'local');
    
    $actions.append($downloadBtn);
    
    // Delete button (in edit mode)
    if (showDelete) {
        const $deleteBtn = $('<button>')
            .addClass('attachment-btn delete')
            .attr('type', 'button')
            .html('<i class="bi bi-trash"></i>')
            .attr('title', 'Delete')
            .data('att-id', att.id)
            .data('entry-id', entryId);
        
        $actions.append($deleteBtn);
    }
    
    $item.append($preview, $meta, $actions);
    
    return $item;
}

/**
 * Handle attachment download click
 */
function handleAttachmentDownload(attachmentId, attachmentName, source) {
    if (source === 'google_drive') {
        downloadGoogleDriveAttachment(attachmentId, attachmentName);
    } else {
        // Local file - direct download
        window.location.href = `download.php?id=${encodeURIComponent(attachmentId)}`;
    }
}

// Initialize on DOM ready
$(document).ready(function() {
    // Initialize Google Drive after a short delay to not block page load
    setTimeout(initGoogleDrive, 500);
    
    // Delegated event handler for download buttons
    $(document).on('click', '.attachment-btn.download, .entry-attach-download', function(e) {
        e.preventDefault();
        const $btn = $(this);
        const attId = $btn.data('att-id');
        const attName = $btn.data('att-name') || 'file';
        const attSource = $btn.data('att-source') || 'local';
        
        handleAttachmentDownload(attId, attName, attSource);
    });
});

// Export functions for use in other modules
window.GDrive = {
    isConnected: () => gdriveConnected,
    canUse: canUseGoogleDrive,
    canUseLocal: canUseLocalUpload,
    authorize: authorizeGoogleDrive,
    openPicker: openGoogleDrivePicker,
    disconnect: disconnectGoogleDrive,
    renderUploadArea: renderAttachmentUploadArea,
    renderItem: renderAttachmentItem,
    handleDownload: handleAttachmentDownload,
    getPendingFiles: getPendingGoogleDriveFiles,
    clearPendingFiles: clearPendingGoogleDriveFiles
};

// Also export attachGoogleDriveFiles directly to window for handler compatibility
window.attachGoogleDriveFiles = attachGoogleDriveFiles;

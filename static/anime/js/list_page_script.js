// =====================================
// FILTER FUNCTIONALITY
// =====================================
let currentFilter = 'all';
let currentSort = 'popular';

document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', function () {
        const selectedGenre = this.dataset.filter;
        const url = new URL(window.location.href);
        const params = url.searchParams;
        const currentGenre = params.get('genre') || 'all';

        // Don't do anything if clicking the same filter
        if (currentGenre === selectedGenre) return;

        // Remove active class from all pills
        document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));

        // Add active class to clicked pill
        this.classList.add('active');

        // Store current filter
        currentFilter = selectedGenre;

        // Trigger filter action via AJAX
        filterAnime(selectedGenre);
    });
});

function filterAnime(filter) {
    // Show loading state
    showLoadingState();

    // Build URL with current sort and new filter
    const url = new URL(window.location);

    // Update or remove genre parameter
    if (filter === 'all') {
        url.searchParams.delete('genre');
    } else {
        url.searchParams.set('genre', filter);
    }

    // Keep existing search query if present
    const searchValue = document.querySelector('#searchInput')?.value?.trim();
    if (searchValue) {
        url.searchParams.set('q', searchValue);
    }

    // Add ajax flag
    url.searchParams.set('ajax', 'true');

    fetch(url.toString(), {
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        }
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.text();
        })
        .then(html => {
            // Parse the returned HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Get the new anime grid content
            const newGrid = doc.querySelector('#animeGrid');
            const currentGrid = document.querySelector('#animeGrid');

            if (newGrid && currentGrid) {
                // Update content immediately
                currentGrid.innerHTML = newGrid.innerHTML;

                // Re-initialize any event listeners for the new cards
                initializeCardListeners();

            } else {
                console.error('Grid elements not found');
                throw new Error('Could not find grid elements in response');
            }

            // Update the results count if present
            updateResults(doc)
            hideLoadingState();
            // Update URL without reloading page (remove ajax param for clean URL)
            url.searchParams.delete('ajax');
            window.history.pushState({}, '', url.toString());
            // Scroll to grid smoothly
            // document.querySelector('#animeGrid')?.scrollIntoView({
            //     behavior: 'smooth',
            //     block: 'start'
            // });
        })
        .catch(error => {
            console.error('Error during filter:', error);
            hideLoadingState();

            // Show error message to user
            const animeContainer = document.querySelector('#animeGrid');
            if (animeContainer) {
                animeContainer.innerHTML = `
                    <div class="col-span-full text-center py-12">
                        <p class="text-red-500 mb-4">Failed to load anime: ${error.message}</p>
                        <button onclick="location.reload()" class="load-more-btn">Reload Page</button>
                    </div>
                `;
            }
        });
}

function updateResults(doc) {
    const newCount = doc.querySelector('.results-number');
    const currentCount = document.querySelector('.results-number');
    if (newCount && currentCount) {
        currentCount.textContent = newCount.textContent;
    }
}

// =====================================
// SORT FUNCTIONALITY
// =====================================
function toggleSort() {
    document.querySelector('.sort-dropdown').classList.toggle('active');
}

document.querySelectorAll('.sort-option').forEach(option => {
    option.addEventListener('click', function () {
        // Remove active from all options
        document.querySelectorAll('.sort-option').forEach(o => o.classList.remove('active'));

        // Add active to clicked option
        this.classList.add('active');

        // Store current sort
        const sortValue = this.dataset.sort;

        // Update button text
        document.querySelector('.sort-button strong').textContent = this.textContent.trim();

        // Close dropdown
        document.querySelector('.sort-dropdown').classList.remove('active');

        // Trigger sort action
        sortAnime(sortValue);
    });
});

function sortAnime(sort) {
    console.log('Sorting by:', sort);

    // Show loading state
    showLoadingState();

    // Build URL with current filters and new sort
    const url = new URL(window.location);
    url.searchParams.set('sort', sort);
    url.searchParams.set('ajax', 'true');

    console.log('Fetching:', url.toString()); // Debug log

    fetch(url.toString(), {
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        }
    })
        .then(response => {
            console.log('Response status:', response.status); // Debug log
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.text();
        })
        .then(html => {
            console.log('HTML received, length:', html.length); // Debug log

            // Parse the returned HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Get the new anime grid content
            const newGrid = doc.querySelector('#animeGrid');
            const currentGrid = document.querySelector('#animeGrid');

            console.log('New grid found:', !!newGrid); // Debug log
            console.log('Current grid found:', !!currentGrid); // Debug log

            if (newGrid && currentGrid) {
                // Update content immediately without fade
                currentGrid.innerHTML = newGrid.innerHTML;

                // Re-initialize any event listeners for the new cards
                initializeCardListeners();

                console.log('Grid updated successfully'); // Debug log
            } else {
                console.error('Grid elements not found');
                throw new Error('Could not find grid elements in response');
            }

            hideLoadingState();

            // Update URL without reloading page (remove ajax param for clean URL)
            url.searchParams.delete('ajax');
            window.history.pushState({}, '', url.toString());
        })
        .catch(error => {
            console.error('Error during sort:', error);
            hideLoadingState();

            // Show error message to user
            const animeContainer = document.querySelector('#animeGrid');
            if (animeContainer) {
                animeContainer.innerHTML = `
                    <div class="col-span-full text-center py-12">
                        <p class="text-red-500 mb-4">Failed to load anime: ${error.message}</p>
                        <button onclick="location.reload()" class="load-more-btn">Reload Page</button>
                    </div>
                `;
            }
        });
}

// Function to reinitialize event listeners for dynamically loaded cards
function initializeCardListeners() {
    // Reinitialize favorite buttons
    // document.querySelectorAll('.favorite-btn').forEach(btn => {
    //     // Remove existing listener to avoid duplicates
    //     btn.removeEventListener('click', handleFavoriteClick);
    //     btn.addEventListener('click', handleFavoriteClick);
    // });

    // Reinitialize card click handlers
    // document.querySelectorAll('.anime-card').forEach(card => {
    //     // Remove existing listener to avoid duplicates
    //     card.removeEventListener('click', handleCardClick);
    //     card.addEventListener('click', handleCardClick);
    // });

    // Add stagger animation to new items
    document.querySelectorAll('.stagger-item').forEach((item, index) => {
        item.style.animationDelay = `${index * 0.05}s`;
    });
}

// Close dropdown when clicking outside
document.addEventListener('click', function (event) {
    const dropdown = document.querySelector('.sort-dropdown');
    if (dropdown && !dropdown.contains(event.target)) {
        dropdown.classList.remove('active');
    }
});


// =====================================
// VIEW TOGGLE
// =====================================
document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', function () {
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');

        const view = this.dataset.view;


        localStorage.setItem('preferredView', view);
    });
});

// Load preferred view
const savedView = localStorage.getItem('preferredView');
if (savedView) {
    document.querySelector(`[data-view="${savedView}"]`)?.click();
}

// =====================================
// FAVORITE TOGGLE
// =====================================
document.querySelectorAll('.favorite-btn').forEach(btn => {
    btn.addEventListener('click', function (e) {
        e.stopPropagation();

        const animeId = this.dataset.animeId;
        const isActive = this.classList.contains('active');

        // Toggle active state
        this.classList.toggle('active');

        // Haptic feedback
        if (navigator.vibrate) {
            navigator.vibrate(50);
        }

        // In production, send to backend
        // fetch('/anime/api/toggle-favorite/', {
        //     method: 'POST',
        //     headers: {
        //         'Content-Type': 'application/json',
        //         'X-CSRFToken': getCookie('csrftoken')
        //     },
        //     body: JSON.stringify({ anime_id: animeId })
        // });

        console.log(isActive ? 'Removed from favorites' : 'Added to favorites', animeId);
    });
});

// =====================================
// SEARCH FUNCTIONALITY
// =====================================
let searchTimeout;
let lastSearchQuery = ''; // Track last search to avoid duplicate requests

document.getElementById('searchInput').addEventListener('input', function (e) {
    clearTimeout(searchTimeout);

    const query = e.target.value.trim();

    // Don't search if it's the same as last query
    if (query === lastSearchQuery) {
        return;
    }

    searchTimeout = setTimeout(() => {
        if (query.length >= 2) {
            searchAnime(query);
        } else if (query.length === 0 && lastSearchQuery !== '') {
            // Only reset if we actually had a previous search
            searchAnime('');
        }
    }, 300); // Debounce for 300ms
});

// Handle Enter key press
document.getElementById("searchInput").addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
        e.preventDefault();
        const query = this.value.trim();

        // Clear timeout and search immediately
        clearTimeout(searchTimeout);
        searchAnime(query);
    }
});

function searchAnime(query) {
    console.log('Searching for:', query || '<empty string>');

    // Update last search query
    lastSearchQuery = query;

    // Show loading state
    showLoadingState();

    // Build URL with current filters, sort, and search query
    const url = new URL(window.location);

    // Update or remove search query
    if (query && query.length > 0) {
        url.searchParams.set('q', query);
    } else {
        url.searchParams.delete('q');
    }

    // Keep existing genre filter if present
    const currentGenre = url.searchParams.get('genre');
    if (currentGenre && currentGenre !== 'all') {
        url.searchParams.set('genre', currentGenre);
    }

    // Keep existing sort if present
    const currentSortParam = url.searchParams.get('sort');
    if (currentSortParam) {
        url.searchParams.set('sort', currentSortParam);
    }

    // Add ajax flag
    url.searchParams.set('ajax', 'true');

    console.log('Fetching:', url.toString()); // Debug log

    fetch(url.toString(), {
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        }
    })
        .then(response => {
            console.log('Response status:', response.status); // Debug log
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.text();
        })
        .then(html => {
            console.log('HTML received, length:', html.length); // Debug log

            // Parse the returned HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Get the new anime grid content
            const newGrid = doc.querySelector('#animeGrid');
            const currentGrid = document.querySelector('#animeGrid');

            console.log('New grid found:', !!newGrid); // Debug log
            console.log('Current grid found:', !!currentGrid); // Debug log

            if (newGrid && currentGrid) {
                // Check if server returned results BEFORE updating
                const serverHasResults = newGrid.querySelector('.anime-card') !== null;
                const serverHasEmptyState = newGrid.querySelector('.empty-state, [class*="empty"]') !== null;

                console.log('Server has results:', serverHasResults, 'Query:', query); // Debug log
                console.log('Server has empty state:', serverHasEmptyState); // Debug log

                // Always update the grid with server content
                currentGrid.innerHTML = newGrid.innerHTML;

                // Ensure grid is visible (in case it was hidden)
                currentGrid.style.display = '';
                currentGrid.style.opacity = '1';

                console.log('Grid children count:', currentGrid.children.length); // Debug log

                // If no results and we have a query, show our custom empty state
                if (!serverHasResults && query && query.length > 0) {
                    showEmptyState();
                }

                // Re-initialize event listeners if we have cards (regardless of query)
                if (serverHasResults) {
                    initializeCardListeners();
                    console.log('Listeners initialized'); // Debug log
                }

                console.log('Grid updated successfully'); // Debug log
            } else {
                console.error('Grid elements not found');
                throw new Error('Could not find grid elements in response');
            }

            // Update the results count if present
            updateResults(doc)

            hideLoadingState();

            // Update URL without reloading page (remove ajax param for clean URL)
            url.searchParams.delete('ajax');
            window.history.pushState({}, '', url.toString());
        })
        .catch(error => {
            console.error('Error during search:', error);
            hideLoadingState();

            // Show error message to user
            const animeContainer = document.querySelector('#animeGrid');
            if (animeContainer) {
                animeContainer.innerHTML = `
                    <div class="col-span-full text-center py-12">
                        <p class="text-red-500 mb-4">Failed to search: ${error.message}</p>
                        <button onclick="location.reload()" class="load-more-btn">Reload Page</button>
                    </div>
                `;
            }
        });
}


// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// =====================================
// CARD CLICK NAVIGATION
// =====================================
document.querySelectorAll('.anime-card').forEach(card => {
    card.addEventListener('click', function (e) {
        // Don't navigate if clicking favorite button
        if (e.target.closest('.favorite-btn')) return;

        // Navigate to detail page
        console.log('Navigate to anime detail');
        // window.location.href = '/anime/detail/';
    });
});


// =====================================
// INFINITE SCROLL FUNCTIONALITY
// =====================================
let currentPage = 1;
let isLoading = false;
let hasNextPage = true;

function loadMoreAnime() {
    if (isLoading || !hasNextPage) return;
    isLoading = true;
    currentPage++;

    // Show loading indicator
    const loader = document.createElement('div');
    loader.classList.add('text-center', 'py-8');
    loader.innerHTML = '<svg class="w-6 h-6 animate-spin inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>';
    document.querySelector('#animeGrid').after(loader);

    const url = new URL(window.location);
    url.searchParams.set('page', currentPage);
    url.searchParams.set('scroll', 'true');
    fetch(url.toString())
        .then(response => response.json())
        .then(data => {
            if (data.results && data.results.length) {
                appendCards(data.results);
            }
            if (!data.has_next) {
                hasNextPage = false;
            }
        })
        .catch(err => console.error('Error loading more anime:', err))
        .finally(() => {
            isLoading = false;
            loader.remove();
        });
}

function appendCards(animeList) {
    const grid = document.getElementById('animeGrid');
    animeList.forEach(anime => {
        const card = document.createElement('div');
        card.innerHTML = anime.html; // Your backend should return rendered HTML or necessary data
        grid.appendChild(card.firstElementChild);
    });
}

// Scroll detection
window.addEventListener('scroll', () => {
    const scrollPosition = window.innerHeight + window.scrollY;
    const threshold = document.documentElement.scrollHeight - 400;
    if (scrollPosition >= threshold && !isLoading) {
        loadMoreAnime();
    }
});


// Uncomment to enable infinite scroll:
// enableInfiniteScroll();

// =====================================
// LOADING STATES
// =====================================

// Helper functions for loading state
function showLoadingState() {
    const grid = document.querySelector('#animeGrid');
    if (grid) {
        grid.style.pointerEvents = 'none';
        grid.style.opacity = '0.6';
    }

    // Add a subtle loading indicator on the sort button
    const sortButton = document.querySelector('.sort-button');
    if (sortButton) {
        sortButton.style.opacity = '0.6';
        sortButton.style.pointerEvents = 'none';
    }
}

function hideLoadingState() {
    const grid = document.querySelector('#animeGrid');
    if (grid) {
        grid.style.pointerEvents = 'auto';
        grid.style.opacity = '1';
    }

    // Restore sort button
    const sortButton = document.querySelector('.sort-button');
    if (sortButton) {
        sortButton.style.opacity = '1';
        sortButton.style.pointerEvents = 'auto';
    }
}


function showEmptyState() {
    document.getElementById('animeGrid').style.display = 'none';
    document.getElementById('emptyState').style.display = 'block';
}

function hideEmptyState() {
    document.getElementById('animeGrid').style.display = 'grid';
    document.getElementById('emptyState').style.display = 'none';
}

// =====================================
// RESET FILTERS
// =====================================
function resetFilters() {
    // Reset filter pills
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-filter="all"]').classList.add('active');

    // Reset search
    document.getElementById('searchInput').value = '';

    // Reset sort
    document.querySelectorAll('.sort-option').forEach(o => o.classList.remove('active'));
    document.querySelector('[data-sort="popular"]').classList.add('active');

    // Reset state
    currentFilter = 'all';
    currentSort = 'popular';
    currentPage = 1;

    // Hide empty state
    hideEmptyState();

    // Reload data
    filterAnime('all');
    window.location.href = `${window.location.origin}/browse`;
}

// =====================================
// LAZY LOADING IMAGES
// =====================================
if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src || img.src;
                img.classList.add('loaded');
                imageObserver.unobserve(img);
            }
        });
    }, {
        rootMargin: '50px'
    });

    document.querySelectorAll('.cover-image').forEach(img => {
        imageObserver.observe(img);
    });
}

// =====================================
// TRACK RECENTLY VIEWED
// =====================================
function trackRecentlyViewed(animeId) {
    let recent = JSON.parse(localStorage.getItem('recentlyViewed') || '[]');

    // Remove if already exists
    recent = recent.filter(id => id !== animeId);

    // Add to beginning
    recent.unshift(animeId);

    // Keep only last 10
    recent = recent.slice(0, 10);

    localStorage.setItem('recentlyViewed', JSON.stringify(recent));
}

// =====================================
// SMOOTH SCROLL TO TOP
// =====================================
function scrollToTop() {
    window.scrollTo({
        top: 0, behavior: 'smooth'
    });
}

// =====================================
// KEYBOARD SHORTCUTS
// =====================================
document.addEventListener('keydown', function (e) {
    // Focus search with "/"
    if (e.key === '/' && !e.target.matches('input, textarea')) {
        e.preventDefault();
        document.getElementById('searchInput').focus();
    }

    // Escape to clear search
    if (e.key === 'Escape') {
        document.getElementById('searchInput').blur();
        document.querySelector('.sort-dropdown').classList.remove('active');
    }
});

// =====================================
// CSRF TOKEN HELPER
// =====================================
function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

// =====================================
// ANALYTICS (Optional)
// =====================================
function trackEvent(category, action, label) {
    console.log('Analytics:', category, action, label);
    // In production: send to Google Analytics, Mixpanel, etc.
}

// Track filter changes
document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', function () {
        trackEvent('Filter', 'Click', this.dataset.filter);
    });
});

// Track card clicks
document.querySelectorAll('.anime-card').forEach(card => {
    card.addEventListener('click', function () {
        trackEvent('Card', 'Click', 'Anime Detail');
    });
});

// =====================================
// INITIALIZE
// =====================================
document.addEventListener('DOMContentLoaded', function () {
    console.log('Anime listing page initialized');

    // Restore filters from URL
    const urlParams = new URLSearchParams(window.location.search);
    const genreParam = urlParams.get('genre');
    const sortParam = urlParams.get('sort');

    if (genreParam) {
        document.querySelector(`[data-filter="${genreParam}"]`)?.click();
    }

    if (sortParam) {
        document.querySelector(`[data-sort="${sortParam}"]`)?.click();
    }
});

// =====================================
// SCROLL REVEAL ANIMATION
// =====================================
// const observerOptions = {
//     threshold: 0.1, rootMargin: '0px 0px -50px 0px'
// };
//
// const revealObserver = new IntersectionObserver((entries) => {
//     entries.forEach(entry => {
//         if (entry.isIntersecting) {
//             entry.target.style.opacity = '1';
//             entry.target.style.transform = 'translateY(0)';
//         }
//     });
// }, observerOptions);
//
// document.querySelectorAll('.stagger-item').forEach(item => {
//     revealObserver.observe(item);
// });
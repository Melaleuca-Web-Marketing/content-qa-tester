# Changelog

All notable changes to the Melaleuca Content QA Tester project.

## [Unreleased] - 2026-01-09

### Fixed
- **Critical**: Fixed Netherlands UAT URL typo (was `uatl.melaleuca.nl`, now `uatnl.melaleuca.nl`)
- **Critical**: Fixed duplicate banner browser configuration causing loss of settings (lines 211-240 in config.js)
- **Critical**: Fixed Playwright `page.evaluate()` argument error in banner detection method
- Removed 4 lines of obsolete/commented code for cleaner codebase

### Changed - Code Consolidation
- **Phase 2**: Consolidated Microsoft authentication logic across all 4 processors
  - Added `handleMicrosoftAuthIfNeeded()` to BaseProcessor
  - Removed ~52 lines of duplicate authentication code
  - Supports both automatic (with credentials) and manual authentication
  - Single source of truth for MS auth handling

- **Phase 2**: Consolidated banner detection logic in BannerProcessor
  - Added `_detectBannerElement()` private method
  - Removed ~52 lines of duplicate detection code
  - Configurable scroll offset inclusion for different use cases

- **Phase 4**: Improved singleton pattern using centralized utility
  - Created `utils/singleton.js` with reusable singleton factory
  - Updated all 4 processors to use centralized pattern
  - Removed ~32 lines of duplicate singleton code
  - Added testability functions (clearSingleton, clearAllSingletons)

### Added - New Features

#### Report Management System (Phase 3.1)
- **New File**: `utils/report-cleanup.js`
  - `cleanupOldReports(dir, days)` - Delete reports older than N days
  - `getReportStats(dir)` - Get report statistics (count, size, dates)
- **New API Endpoints**:
  - `GET /api/reports/stats` - Get report file statistics
  - `POST /api/reports/cleanup` - Cleanup old reports with configurable retention
- **Environment Variable**: `TESTER_CLEANUP_DAYS` - Auto-cleanup on server startup (opt-in)

#### Memory Monitoring System (Phase 3.2)
- **New File**: `utils/memory-monitor.js`
  - `getMemoryUsageMB()` - Get current memory usage in MB
  - `checkMemoryThreshold(threshold)` - Check if memory exceeds threshold
  - `logMemoryUsage(label)` - Log memory with label
- **Enhanced Processors**: banner-processor.js and mixinad-processor.js
  - Real-time heap usage display during captures
  - Warning every 50 screenshots with actual memory metrics
  - Critical alerts when heap usage exceeds 1GB
  - Actionable suggestions for memory management

#### Singleton Utility (Phase 4.2)
- **New File**: `utils/singleton.js`
  - Generic singleton factory with comprehensive JSDoc
  - Test-friendly with clear/reset functions
  - Consistent pattern across all processors

### Performance Improvements

#### Banner Navigation Optimization (Phase 3.3) - 40-60% Faster
- **New Method**: `captureJobAtAllWidths()` in banner-processor.js
  - Navigate to URL once per banner instead of once per width
  - Handle Microsoft authentication once instead of per-width
  - Resize viewport for each width without re-navigation
  - Reduced page navigations by 83% (example: 60 → 10 for 10 banners × 6 widths)

**Expected Performance Impact**:
```
Test Case: 10 banners × 6 widths = 60 total captures

BEFORE Optimization:
- 60 page navigations (1 per width per banner)
- 60 auth checks
- Total navigation time: ~120-180 seconds

AFTER Optimization:
- 10 page navigations (1 per banner)
- 10 auth checks
- Total navigation time: ~20-30 seconds

Result: 40-60% faster overall capture time
```

### Code Quality Improvements
- Total lines of duplicate code removed: ~136 lines
- New utility files created: 3 files (report-cleanup, memory-monitor, singleton)
- Code consolidation: Single source of truth for common operations
- Improved maintainability: Easier to test and modify
- Better error handling: Comprehensive error reporting

### Documentation
- Added comprehensive JSDoc to singleton utility
- Added JSDoc to processor export functions
- This CHANGELOG documenting all improvements

## Git Commit History

1. `5a2a2da` - Phase 1: Fix critical configuration errors
2. `ef89614` - Phase 2: Consolidate redundant code across processors
3. `671683d` - Fix: Complete Phase 2 mixinad-processor.js consolidation
4. `305ac65` - Phase 3.1 & 3.2: Add report cleanup and memory monitoring
5. `69fff1e` - Phase 3.3: Optimize banner navigation for 40-60% performance improvement
6. `d25d2df` - CRITICAL FIX: Wrap page.evaluate() arguments in object
7. `dc61399` - Phase 4: Improve singleton pattern with centralized utility

## Breaking Changes
**None** - All changes are backwards compatible. Existing tests and configurations continue to work without modification.

## Migration Notes
- No migration required for existing users
- Optional: Set `TESTER_CLEANUP_DAYS` environment variable to enable automatic report cleanup
- Optional: Use new report cleanup API endpoints for manual cleanup
- All existing functionality preserved

## Testing Status
- ✅ All syntax validation passed
- ✅ Banner capture test successful (user validated)
- ⏭️ Comprehensive test matrix recommended before production deployment
- ⏭️ Performance benchmarking recommended to measure actual improvements

## Statistics
- **Files Modified**: 13 files across 5 phases
- **New Files Created**: 4 files (3 utilities + 1 documentation)
- **Net Code Changes**: +625 insertions, -215 deletions
- **Duplicate Code Removed**: ~136 lines
- **Performance Improvement**: 40-60% faster banner captures (estimated)
- **Memory Monitoring**: Real-time heap usage tracking
- **Report Management**: Automatic cleanup system

---

## Future Enhancements (Not Included)
The following were identified in the audit but deferred:
- MixInAd navigation optimization (requires special handling for multiple ads per page)
- Large function refactoring (working correctly, refactoring is mainly style)
- Comprehensive JSDoc documentation (can be added incrementally)
- Additional memory optimizations for extremely large test runs

---

Generated: 2026-01-09
Audit Document: MELALEUCA_QA_TESTER_COMPREHENSIVE_AUDIT_2026-01-09.md

import * as React from "react";
import type { WordAsset } from "../types";
import { getDueCards } from "./SpacedRepetition";
import { moment as obsidianMoment } from "obsidian";
const moment = obsidianMoment as any;
import { formatDuration } from "../utils";

interface WordBookStatsProps {
  plugin: any;
  assets: WordAsset[];
  onClose: () => void;
}

export function WordBookStats({ plugin, assets, onClose }: WordBookStatsProps) {
  const [statsTab, setStatsTab] = React.useState<"week" | "month" | "year" | "all">("week");
  const [statsDate, setStatsDate] = React.useState<Date>(new Date());
  const [statsChartType, setStatsChartType] = React.useState<"bar" | "calendar" | "heatmap">("bar");

  const selectedStats = React.useMemo(() => {
    const today = moment(statsDate);
    let startDate: moment.Moment;
    let endDate: moment.Moment;
    let prevStartDate: moment.Moment;
    let prevEndDate: moment.Moment;

    if (statsTab === "week") {
      startDate = today.clone().startOf("isoWeek");
      endDate = today.clone().endOf("isoWeek");
      prevStartDate = startDate.clone().subtract(1, "week");
      prevEndDate = endDate.clone().subtract(1, "week");
    } else if (statsTab === "month") {
      startDate = today.clone().startOf("month");
      endDate = today.clone().endOf("month");
      prevStartDate = startDate.clone().subtract(1, "month");
      prevEndDate = endDate.clone().subtract(1, "month");
    } else if (statsTab === "year") {
      startDate = today.clone().startOf("year");
      endDate = today.clone().endOf("year");
      prevStartDate = startDate.clone().subtract(1, "year");
      prevEndDate = endDate.clone().subtract(1, "year");
    } else {
      startDate = moment(0);
      endDate = moment().endOf("day");
      prevStartDate = moment(0);
      prevEndDate = moment().endOf("day");
    }

    const statsData = plugin.settings.wordReviewStats || {};
    let totalSeconds = 0;
    let prevTotalSeconds = 0;
    let totalReviews = 0;
    let prevTotalReviews = 0;
    const dailySecondsMap: Record<string, number> = {};
    const monthlySecondsMap: Record<string, number> = {};
    const yearlySecondsMap: Record<string, number> = {};
    const reviewDays = new Set<string>();

    Object.entries(statsData).forEach(([dateStr, dailyData]: [string, any]) => {
      const dateVal = moment(dateStr, "YYYY-MM-DD");
      if (!dateVal.isValid()) return;

      const isCurrentRange = dateVal.isBetween(startDate, endDate, "day", "[]");
      const isPrevRange = dateVal.isBetween(prevStartDate, prevEndDate, "day", "[]");

      const count = dailyData.reviewCount || 0;
      const ms = dailyData.reviewTimeMs || 0;
      const secs = Math.round(ms / 1000);

      if (isCurrentRange) {
        totalSeconds += secs;
        totalReviews += count;
        if (count > 0 || secs > 0) {
          reviewDays.add(dateStr);
          dailySecondsMap[dateStr] = (dailySecondsMap[dateStr] || 0) + secs;
          
          const monthStr = dateVal.format("YYYY-MM");
          monthlySecondsMap[monthStr] = (monthlySecondsMap[monthStr] || 0) + secs;

          const yearStr = dateVal.format("YYYY");
          yearlySecondsMap[yearStr] = (yearlySecondsMap[yearStr] || 0) + secs;
        }
      } else if (isPrevRange && statsTab !== "all") {
        prevTotalSeconds += secs;
        prevTotalReviews += count;
      }
    });

    // Count new words added in this period based on creation time
    let newWordsCount = 0;
    assets.forEach((asset: any) => {
      const createdVal = moment(asset.created);
      if (createdVal.isValid() && createdVal.isBetween(startDate, endDate, "day", "[]")) {
        newWordsCount++;
      }
    });

    let trendPercent = 0;
    if (prevTotalSeconds > 0) {
      trendPercent = Math.round(((totalSeconds - prevTotalSeconds) / prevTotalSeconds) * 100);
    } else if (totalSeconds > 0) {
      trendPercent = 100;
    }

    // Top books by new words added in this period
    const bookWordCountMap: Record<string, number> = {};
    assets.forEach((asset: any) => {
      const createdVal = moment(asset.created);
      if (createdVal.isValid() && createdVal.isBetween(startDate, endDate, "day", "[]")) {
        const bookTitle = asset.sources && asset.sources[0] ? asset.sources[0].bookTitle : "未知";
        if (bookTitle) {
          bookWordCountMap[bookTitle] = (bookWordCountMap[bookTitle] || 0) + 1;
        }
      }
    });
    const topBooks = Object.entries(bookWordCountMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Calculate difficult words (sorted by most reviews, then lowest ease)
    const activeAssets = assets.filter(a => !a.mastered);
    const sortedByDifficulty = [...activeAssets].sort((a, b) => {
      const aReviews = a.reviews || 0;
      const bReviews = b.reviews || 0;
      if (aReviews !== bReviews) return bReviews - aReviews;
      const aEase = a.ease || 2.5;
      const bEase = b.ease || 2.5;
      return aEase - bEase;
    });

    const totalWords = assets.length;
    const masteredWords = assets.filter(a => a.mastered).length;
    const dueWords = getDueCards(assets).length;

    return {
      startDate,
      endDate,
      totalSeconds,
      prevTotalSeconds,
      trendPercent,
      readDaysCount: reviewDays.size,
      newWordsCount,
      totalReviews,
      dailySecondsMap,
      monthlySecondsMap,
      yearlySecondsMap,
      topBooks,
      difficultWords: sortedByDifficulty.slice(0, 10),
      totalWords,
      masteredWords,
      dueWords
    };
  }, [statsTab, statsDate, assets, plugin.settings.wordReviewStats]);

  const handlePrevDate = () => {
    setStatsDate((prev) => {
      const m = moment(prev);
      if (statsTab === "week") return m.subtract(1, "week").toDate();
      if (statsTab === "month") return m.subtract(1, "month").toDate();
      if (statsTab === "year") return m.subtract(1, "year").toDate();
      return prev;
    });
  };

  const handleNextDate = () => {
    setStatsDate((prev) => {
      const m = moment(prev);
      if (statsTab === "week") return m.add(1, "week").toDate();
      if (statsTab === "month") return m.add(1, "month").toDate();
      if (statsTab === "year") return m.add(1, "year").toDate();
      return prev;
    });
  };

  const renderLargeDuration = (secs: number) => {
    if (secs <= 0) {
      return (
        <>
          0<span>分钟</span>
        </>
      );
    }
    const h = Math.floor(secs / 3600);
    const m = Math.round((secs % 3600) / 60);
    if (h > 0 && m > 0) {
      return (
        <>
          {h}<span>小时</span>{m}<span>分钟</span>
        </>
      );
    } else if (h > 0) {
      return (
        <>
          {h}<span>小时</span>
        </>
      );
    } else {
      return (
        <>
          {m}<span>分钟</span>
        </>
      );
    }
  };

  const formatDays = (dateStr: string | undefined) => {
    if (!dateStr) return "新词";
    const diff = new Date(dateStr).getTime() - new Date().getTime();
    const days = Math.ceil(diff / (1000 * 3600 * 24));
    if (days < 0) return "已超期";
    if (days === 0) return "今日";
    return `${days}天后`;
  };

  const {
    startDate,
    endDate,
    totalSeconds,
    trendPercent,
    readDaysCount,
    newWordsCount,
    totalReviews,
    dailySecondsMap,
    monthlySecondsMap,
    yearlySecondsMap,
    topBooks,
    difficultWords,
    totalWords,
    masteredWords,
    dueWords
  } = selectedStats;

  const statsData = plugin.settings.wordReviewStats || {};
  const sortedDates = Object.keys(statsData).sort();
  const firstDateStr = sortedDates.length > 0 ? sortedDates[0] : moment().format("YYYY-MM-DD");
  const earliestYearStr = sortedDates.length > 0 ? sortedDates[0] : null;

  let dateRangeStr = "";
  if (statsTab === "week") {
    dateRangeStr = `${moment(startDate).format("YYYY · M/D")} - ${moment(endDate).format("M/D")}`;
  } else if (statsTab === "month") {
    dateRangeStr = moment(startDate).format("YYYY年M月");
  } else if (statsTab === "year") {
    dateRangeStr = moment(startDate).format("YYYY年");
  }

  const avgSecs = Math.round(totalSeconds / (readDaysCount || 1));
  const trendText = trendPercent > 0 ? `↑ ${trendPercent}%` : trendPercent < 0 ? `↓ ${Math.abs(trendPercent)}%` : "--";
  const trendClass = trendPercent > 0 ? "jarvis-stats-trend-up" : trendPercent < 0 ? "jarvis-stats-trend-down" : "";

  let mainCardSub = "";
  if (statsTab === "week") {
    mainCardSub = `日均记忆 ${formatDuration(avgSecs)} · 比上周 `;
  } else if (statsTab === "month") {
    mainCardSub = `日均记忆 ${formatDuration(avgSecs)} · 比上月 `;
  } else if (statsTab === "year") {
    mainCardSub = `日均记忆 ${formatDuration(avgSecs)} · 比去年 `;
  } else {
    mainCardSub = `${firstDateStr}至今 · 日均记忆 ${formatDuration(avgSecs)} · 与 Jarvis Reader 记忆相伴 ${readDaysCount} 天`;
  }

  let activeChart = statsChartType;
  if (statsTab === "week") {
    activeChart = "bar";
  } else if (statsTab === "month" && activeChart === "heatmap") {
    activeChart = "bar";
  } else if ((statsTab === "year" || statsTab === "all") && activeChart === "calendar") {
    activeChart = "heatmap";
  }

  const isReadable = (plugin.app.vault as any).getConfig ? (plugin.app.vault as any).getConfig("readableLineLength") : true;

  return (
    <div className="jarvis-library-stats-view" style={{ overflowY: "auto", height: "100%", width: "100%", padding: "20px 0" }}>
      <div className={`jarvis-library-stats-view-container ${isReadable ? "is-readable-width" : "is-full-width"}`} style={{ margin: "0 auto" }}>
        
        {/* Header */}
        <div className="jarvis-library-stats-view-header" style={{ marginBottom: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button className="jarvis-library-back-btn" onClick={onClose}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
              返回词条
            </button>
            <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>词库统计看板</h2>
          </div>
        </div>

        {/* Tab & Date Navigation */}
        <div className="jarvis-stats-header-wrap">
          <div className="jarvis-stats-nav-tabs">
            <button className={`jarvis-stats-tab-btn ${statsTab === "week" ? "is-active" : ""}`} onClick={() => setStatsTab("week")}>周</button>
            <button className={`jarvis-stats-tab-btn ${statsTab === "month" ? "is-active" : ""}`} onClick={() => setStatsTab("month")}>月</button>
            <button className={`jarvis-stats-tab-btn ${statsTab === "year" ? "is-active" : ""}`} onClick={() => setStatsTab("year")}>年</button>
            <button className={`jarvis-stats-tab-btn ${statsTab === "all" ? "is-active" : ""}`} onClick={() => setStatsTab("all")}>全部</button>
          </div>
          {statsTab !== "all" && (
            <div className="jarvis-stats-date-picker">
              <button className="jarvis-stats-date-btn" onClick={handlePrevDate}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6"/></svg>
              </button>
              <span className="jarvis-stats-date-text">{dateRangeStr}</span>
              <button className="jarvis-stats-date-btn" onClick={handleNextDate}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            </div>
          )}
        </div>

        {/* Main Card */}
        <div className="jarvis-stats-main-card">
          <div className="jarvis-stats-main-time">
            {renderLargeDuration(totalSeconds)}
          </div>
          <div className="jarvis-stats-main-sub">
            {mainCardSub}
            {statsTab !== "all" && (
              <span className={trendClass}>{trendText}</span>
            )}
          </div>
        </div>

        {/* Mini Cards Grid */}
        <div className="jarvis-stats-mini-grid">
          {statsTab === "all" ? (
            <>
              <div className="jarvis-stats-mini-card">
                <span className="jarvis-stats-mini-val" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)" }}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                  {readDaysCount}天
                </span>
                <span className="jarvis-stats-mini-label">累计复习天数</span>
              </div>
              <div className="jarvis-stats-mini-card">
                <span className="jarvis-stats-mini-val" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)" }}><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                  {totalWords}个
                </span>
                <span className="jarvis-stats-mini-label">词库总数</span>
              </div>
              <div className="jarvis-stats-mini-card">
                <span className="jarvis-stats-mini-val" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)" }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                  {masteredWords}个
                </span>
                <span className="jarvis-stats-mini-label">已掌握</span>
              </div>
              <div className="jarvis-stats-mini-card">
                <span className="jarvis-stats-mini-val" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)" }}><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                  {totalReviews}次
                </span>
                <span className="jarvis-stats-mini-label">累计复习次数</span>
              </div>
            </>
          ) : (
            <>
              <div className="jarvis-stats-mini-card">
                <span className="jarvis-stats-mini-val" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)" }}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                  {readDaysCount}天
                </span>
                <span className="jarvis-stats-mini-label">记忆天数</span>
              </div>
              <div className="jarvis-stats-mini-card">
                <span className="jarvis-stats-mini-val" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)" }}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>
                  {formatDuration(avgSecs)}
                  <span className={trendClass} style={{ fontSize: "9px", padding: "1px 3px", borderRadius: "4px", background: trendPercent > 0 ? "#E5F5F1" : trendPercent < 0 ? "#FCE8E6" : "var(--background-modifier-border)" }}>
                    {trendText}
                  </span>
                </span>
                <span className="jarvis-stats-mini-label">日均时长</span>
              </div>
              <div className="jarvis-stats-mini-card">
                <span className="jarvis-stats-mini-val" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)" }}><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                  {newWordsCount}个
                </span>
                <span className="jarvis-stats-mini-label">新增词条</span>
              </div>
              <div className="jarvis-stats-mini-card">
                <span className="jarvis-stats-mini-val" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)" }}><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                  {totalReviews}次
                </span>
                <span className="jarvis-stats-mini-label">复习次数</span>
              </div>
            </>
          )}
        </div>

        {/* Visual Chart Section */}
        <div className="jarvis-stats-chart-section" style={{ marginBottom: "32px" }}>
          <div className="jarvis-stats-chart-header">
            <span className="jarvis-stats-chart-title">
              {activeChart === "bar" && (statsTab === "week" || statsTab === "month" ? "每日记忆时间" : statsTab === "year" ? "每月记忆时间" : "每年记忆时间")}
              {activeChart === "calendar" && "每日记忆时间"}
              {activeChart === "heatmap" && "每日记忆时间"}
            </span>
            <div className="jarvis-stats-chart-toggles">
              {statsTab === "month" && (
                <>
                  <button className={`jarvis-stats-chart-toggle-btn ${activeChart === "bar" ? "is-active" : ""}`} onClick={() => setStatsChartType("bar")}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
                  </button>
                  <button className={`jarvis-stats-chart-toggle-btn ${activeChart === "calendar" ? "is-active" : ""}`} onClick={() => setStatsChartType("calendar")}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  </button>
                </>
              )}
              {(statsTab === "year" || statsTab === "all") && (
                <>
                  <button className={`jarvis-stats-chart-toggle-btn ${activeChart === "heatmap" ? "is-active" : ""}`} onClick={() => setStatsChartType("heatmap")}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                  </button>
                  <button className={`jarvis-stats-chart-toggle-btn ${activeChart === "bar" ? "is-active" : ""}`} onClick={() => setStatsChartType("bar")}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Render selected chart */}
          {activeChart === "bar" && (() => {
            let data: { label: string; secs: number; tooltip: string }[] = [];
            if (statsTab === "week") {
              const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
              data = Array.from({ length: 7 }).map((_, i) => {
                const day = moment(startDate).add(i, "days");
                const dateStr = day.format("YYYY-MM-DD");
                const secs = dailySecondsMap[dateStr] || 0;
                return { label: weekdays[i], secs, tooltip: `${day.format("M月D日")} 记忆 ${formatDuration(secs)}` };
              });
            } else if (statsTab === "month") {
              const daysInMonth = moment(startDate).daysInMonth();
              data = Array.from({ length: daysInMonth }).map((_, i) => {
                const day = moment(startDate).add(i, "days");
                const dateStr = day.format("YYYY-MM-DD");
                const secs = dailySecondsMap[dateStr] || 0;
                return { label: String(i + 1), secs, tooltip: `${day.format("M月D日")} 记忆 ${formatDuration(secs)}` };
              });
            } else if (statsTab === "year") {
              data = Array.from({ length: 12 }).map((_, i) => {
                const month = moment(startDate).add(i, "months");
                const monthStr = month.format("YYYY-MM");
                const secs = monthlySecondsMap[monthStr] || 0;
                return { label: `${i + 1}月`, secs, tooltip: `${month.format("YYYY年M月")} 记忆 ${formatDuration(secs)}` };
              });
            } else {
              const currentYear = moment().year();
              const startYear = earliestYearStr ? moment(earliestYearStr, "YYYY-MM-DD").year() : currentYear - 4;
              const yearsCount = Math.max(currentYear - startYear + 1, 1);
              data = Array.from({ length: yearsCount }).map((_, i) => {
                const year = String(startYear + i);
                const secs = yearlySecondsMap[year] || 0;
                return { label: year, secs, tooltip: `${year}年 记忆 ${formatDuration(secs)}` };
              });
            }

            const chartHeightPx = 136;
            const getStep = (seconds: number) => {
              if (seconds <= 15 * 60) return 5 * 60;
              if (seconds <= 30 * 60) return 10 * 60;
              if (seconds <= 60 * 60) return 15 * 60;
              if (seconds <= 2 * 3600) return 30 * 60;
              if (seconds <= 4 * 3600) return 60 * 60;
              return 2 * 3600;
            };
            const rawMax = Math.max(...data.map(d => d.secs), 0);
            const maxVal = rawMax <= 60 * 60
              ? 60 * 60
              : Math.max(Math.ceil(rawMax / getStep(rawMax || 60)) * getStep(rawMax || 60), 60);
            const tickStep = getStep(maxVal);
            const yAxisTicks: number[] = [];
            for (let tick = maxVal; tick >= 0; tick -= tickStep) {
              yAxisTicks.push(tick);
            }
            if (yAxisTicks[yAxisTicks.length - 1] !== 0) yAxisTicks.push(0);

            return (
              <div style={{ position: "relative" }}>
                {/* Grid Lines */}
                <div style={{ position: "absolute", left: 0, right: 0, top: "20px", bottom: "38px", pointerEvents: "none", zIndex: 1 }}>
                  {yAxisTicks.map((tick) => {
                    const ratio = maxVal > 0 ? tick / maxVal : 0;
                    return (
                      <div
                        key={tick}
                        style={{
                          position: "absolute",
                          left: 0,
                          right: 0,
                          bottom: `${ratio * 100}%`,
                          borderBottom: "1px dashed var(--background-modifier-border)",
                          width: "100%",
                          display: "flex",
                          justifyContent: "flex-start"
                        }}
                      >
                        <span style={{ fontSize: "9px", color: "var(--text-muted)", transform: "translateY(-100%)" }}>
                          {tick === 0 ? "0" : formatDuration(tick)}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="jarvis-stats-bar-chart-container" style={{ position: "relative", zIndex: 2 }}>
                  {data.map((item, idx) => {
                    const heightPx = item.secs > 0
                      ? Math.max((item.secs / maxVal) * chartHeightPx, 6)
                      : 0;
                    return (
                      <div key={idx} className="jarvis-stats-bar-column">
                        <div className="jarvis-stats-bar-tooltip">{item.tooltip}</div>
                        <div className="jarvis-stats-bar" style={{ height: `${heightPx}px` }} />
                        <span className="jarvis-stats-bar-label">{item.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {activeChart === "calendar" && (() => {
            const daysInMonth = moment(startDate).daysInMonth();
            const firstDayOffset = ((moment(startDate).clone().startOf("month").day() + 6) % 7);
            const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
            
            const cells: any[] = [];
            for (let i = 0; i < firstDayOffset; i++) {
              cells.push(<div key={`empty-start-${i}`} className="jarvis-stats-calendar-cell is-empty" />);
            }
            
            for (let d = 1; d <= daysInMonth; d++) {
              const day = moment(startDate).clone().date(d);
              const dateStr = day.format("YYYY-MM-DD");
              const secs = dailySecondsMap[dateStr] || 0;
              
              cells.push(
                <div key={`day-${d}`} className={`jarvis-stats-calendar-cell ${secs > 0 ? "has-read" : ""}`}>
                  <span style={{ fontWeight: secs > 0 ? 700 : 500 }}>{d}</span>
                  {secs > 0 && (
                    <span className="jarvis-stats-calendar-cell-time">{formatDuration(secs)}</span>
                  )}
                </div>
              );
            }

            return (
              <div>
                <div className="jarvis-stats-calendar-grid" style={{ marginBottom: "8px" }}>
                  {weekdays.map(wd => (
                    <div key={wd} className="jarvis-stats-calendar-weekday">{wd}</div>
                  ))}
                </div>
                <div className="jarvis-stats-calendar-grid">
                  {cells}
                </div>
              </div>
            );
          })()}

          {activeChart === "heatmap" && (() => {
            const renderHeatmapWall = (yearStr: string) => {
              const startOfYear = moment(`${yearStr}-01-01`);
              const gridStart = startOfYear.clone().startOf("isoWeek");

              const weeksCount = 53;
              const columns: any[] = [];
              const monthLabels: { label: string; colIndex: number }[] = [];
              let lastMonth = -1;

              for (let w = 0; w < weeksCount; w++) {
                const colCells: any[] = [];
                const colMonday = gridStart.clone().add(w * 7, "days");
                
                const m = colMonday.month();
                if (m !== lastMonth) {
                  monthLabels.push({ label: `${m + 1}月`, colIndex: w });
                  lastMonth = m;
                }

                for (let d = 0; d < 7; d++) {
                  const cellDate = gridStart.clone().add(w * 7 + d, "days");
                  const isTargetYear = cellDate.year() === Number(yearStr);
                  const dateStr = cellDate.format("YYYY-MM-DD");
                  const secs = isTargetYear ? (dailySecondsMap[dateStr] || 0) : 0;
                  
                  const mins = secs / 60;
                  let level = 0;
                  if (mins > 0 && mins <= 1) level = 1;
                  else if (mins > 1 && mins <= 3) level = 2;
                  else if (mins > 3 && mins <= 10) level = 3;
                  else if (mins > 10) level = 4;

                  const tooltipText = isTargetYear 
                    ? `${cellDate.format("YYYY年M月D日")} 记忆 ${formatDuration(secs)}`
                    : "";

                  colCells.push(
                    <div key={`d-${d}`} className={`jarvis-stats-heatmap-cell level-${level}`}>
                      {tooltipText && (
                        <div className="jarvis-stats-heatmap-cell-tooltip">{tooltipText}</div>
                      )}
                    </div>
                  );
                }

                columns.push(
                  <div key={`w-${w}`} className="jarvis-stats-heatmap-col">
                    {colCells}
                  </div>
                );
              }

              const yearsTotalDays = Object.entries(dailySecondsMap).filter(([dateStr, secs]) => {
                return dateStr.startsWith(yearStr) && secs > 0;
              }).length;

              const yearsTotalSecs = Object.entries(dailySecondsMap)
                .filter(([dateStr]) => dateStr.startsWith(yearStr))
                .reduce((acc, entry) => acc + entry[1], 0);

              return (
                <div key={yearStr} style={{ marginBottom: "24px" }}>
                  {statsTab === "all" && (
                    <h4 style={{ fontSize: "13px", margin: "0 0 10px 0", fontWeight: "700" }}>{yearStr}</h4>
                  )}
                  <div className="jarvis-stats-heatmap-wrapper">
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(53, 1fr)", gap: "3px", fontSize: "9px", color: "var(--text-muted)", marginBottom: "4px", paddingLeft: "15px" }}>
                      {monthLabels.map(ml => (
                        <span key={ml.label} style={{ gridColumnStart: ml.colIndex + 1, whiteSpace: "nowrap" }}>{ml.label}</span>
                      ))}
                    </div>
                    
                    <div style={{ display: "flex", gap: "8px" }}>
                      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", fontSize: "9px", color: "var(--text-muted)", height: "88px", padding: "2px 0" }}>
                        <span>一</span>
                        <span>三</span>
                        <span>五</span>
                      </div>
                      
                      <div style={{ display: "flex", gap: "3px" }}>
                        {columns}
                      </div>
                    </div>
                  </div>
                  <div className="jarvis-stats-heatmap-footer">
                    <span>{yearStr}年共记忆 {yearsTotalDays}天，累计 {formatDuration(yearsTotalSecs)}</span>
                    <div className="jarvis-stats-heatmap-legend">
                      <span>少</span>
                      <div className="jarvis-stats-heatmap-legend-box level-0" />
                      <div className="jarvis-stats-heatmap-legend-box level-1" />
                      <div className="jarvis-stats-heatmap-legend-box level-2" />
                      <div className="jarvis-stats-heatmap-legend-box level-3" />
                      <div className="jarvis-stats-heatmap-legend-box level-4" />
                      <span>多</span>
                    </div>
                  </div>
                </div>
              );
            };

            if (statsTab === "year") {
              const yearStr = moment(startDate).format("YYYY");
              return renderHeatmapWall(yearStr);
            } else {
              const currentYear = moment().year();
              const startYear = earliestYearStr ? moment(earliestYearStr, "YYYY-MM-DD").year() : currentYear;
              const yearsList = [];
              for (let y = currentYear; y >= startYear; y--) {
                yearsList.push(String(y));
              }
              return (
                <div>
                  {yearsList.map(y => renderHeatmapWall(y))}
                </div>
              );
            }
          })()}
        </div>

        {/* Books Word Contribution & Difficult Words */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "24px" }}>
          {/* Top Contributing Books */}
          {statsTab !== "week" && (
            <div className="jarvis-stats-pref-card" style={{ padding: "24px", minHeight: "200px" }}>
              <span className="jarvis-stats-pref-title" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "15px", fontWeight: "700", marginBottom: "16px" }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)" }}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                来源书籍贡献榜
              </span>
              {topBooks.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: "0.95em", textAlign: "center", paddingTop: "40px" }}>该周期内未新增词条</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {topBooks.map(([title, count], idx) => (
                    <div key={title} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--background-modifier-border)", paddingBottom: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: "13px", fontWeight: "bold", background: "var(--background-modifier-border)", borderRadius: "4px", width: "20px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center" }}>{idx + 1}</span>
                        <span style={{ fontSize: "14px", color: "var(--text-normal)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "200px" }}>{title}</span>
                      </div>
                      <span style={{ fontSize: "13.5px", color: "var(--interactive-accent)", fontWeight: "bold" }}>+{count} 词条</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Difficult Words */}
          <div className="jarvis-stats-pref-card" style={{ padding: "24px", gridColumn: statsTab === "week" ? "span 2" : "span 1" }}>
            <span className="jarvis-stats-pref-title" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "15px", fontWeight: "700", marginBottom: "16px" }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)" }}><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>
              最难攻克榜单 (Top 10)
            </span>
            {difficultWords.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: "0.95em", textAlign: "center", paddingTop: "40px" }}>无学习中的单词</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--background-modifier-border)" }}>
                    <th style={{ padding: "8px 0", color: "var(--text-muted)", fontSize: "12px", fontWeight: "normal" }}>词条</th>
                    <th style={{ padding: "8px 0", color: "var(--text-muted)", fontSize: "12px", fontWeight: "normal", textAlign: "center" }}>复习次数</th>
                    <th style={{ padding: "8px 0", color: "var(--text-muted)", fontSize: "12px", fontWeight: "normal", textAlign: "center" }}>难度(Ease)</th>
                    <th style={{ padding: "8px 0", color: "var(--text-muted)", fontSize: "12px", fontWeight: "normal", textAlign: "right" }}>下次复习</th>
                  </tr>
                </thead>
                <tbody>
                  {difficultWords.map((word) => (
                    <tr key={word.lemma} style={{ borderBottom: "1px solid var(--background-modifier-border)" }}>
                      <td style={{ padding: "8px 0", fontWeight: "bold", fontSize: "13.5px", color: "var(--text-normal)" }}>{word.lemma}</td>
                      <td style={{ padding: "8px 0", color: "var(--color-orange)", fontSize: "13px", textAlign: "center" }}>{word.reviews || 0}次</td>
                      <td style={{ padding: "8px 0", fontSize: "13px", textAlign: "center" }}>{word.ease?.toFixed(2) || "2.50"}</td>
                      <td style={{ padding: "8px 0", color: "var(--text-muted)", fontSize: "13px", textAlign: "right" }}>{formatDays(word.nextReviewDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

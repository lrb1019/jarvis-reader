import * as React from "react";
import type { WordAsset } from "../types";
import { calculateNextReview, ReviewResponse } from "./SpacedRepetition";
import { MarkdownPreview } from "./WordCard";
import { buildWordAudioUrl } from "../word-assets";
import { Notice } from "obsidian";

interface ReviewSessionProps {
  plugin: any;
  dueAssets: WordAsset[];
  onComplete: () => void;
  onAssetUpdate: () => void; // Triggered when an asset is updated to refresh the list
}

export function ReviewSession({ plugin, dueAssets, onComplete, onAssetUpdate }: ReviewSessionProps) {
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [showAnswer, setShowAnswer] = React.useState(false);
  const [startTime, setStartTime] = React.useState(Date.now());

  const playAudio = React.useCallback((text: string) => {
    if (plugin.settings.enableWordAudio !== false) {
      try {
        const accent = plugin.settings.wordAudioAccent || "us";
        const template = plugin.settings.wordAudioTemplate || "https://dict.youdao.com/dictvoice?audio={{word}}&type={{type}}";
        const url = buildWordAudioUrl(template, text, accent);
        if (url) {
          new Audio(url).play().catch(() => {});
        }
      } catch (e) {
        console.error("Audio playback failed", e);
      }
    }
  }, [plugin]);

  React.useEffect(() => {
    setStartTime(Date.now());
    if (plugin.settings.autoPlayAudioOnReview !== false && dueAssets[currentIndex]) {
      const asset = dueAssets[currentIndex];
      const isSentence = asset.kind === "sentence";
      const displayWord = isSentence ? (asset.sources?.[0]?.quote || asset.lemma) : asset.lemma;
      playAudio(displayWord);
    }
  }, [currentIndex, dueAssets, plugin, playAudio]);

  if (dueAssets.length === 0 || currentIndex >= dueAssets.length) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: "40px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px", color: "var(--color-green)" }}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          <h2 style={{ margin: 0, fontSize: "1.4em", fontWeight: "600", color: "var(--color-green)" }}>复习完成！</h2>
        </div>
        <p style={{ color: "var(--text-muted)", marginBottom: "32px" }}>您已经完成了今天所有的复习任务。</p>
        <button className="jarvis-library-back-btn" onClick={onComplete} style={{ padding: "8px 24px !important", fontSize: "1.1em" }}>返回词条</button>
      </div>
    );
  }

  const asset = dueAssets[currentIndex];
  


  const startingEase = plugin.settings.sm2StartingEase ?? 2.5;
  const easyBonus = plugin.settings.sm2EasyBonus ?? 1.3;
  const lapseMultiplier = plugin.settings.sm2LapseMultiplier ?? 0.5;
  const maxInterval = plugin.settings.sm2MaxInterval ?? 365;
  const reviewOptions = { startingEase, easyBonus, lapseMultiplier, maxInterval };

  const handleReview = async (response: ReviewResponse) => {
    const timeSpent = Date.now() - startTime;
    const { nextReviewDate, interval, ease, reviews } = calculateNextReview(
      response,
      asset.interval || 0,
      asset.ease || startingEase,
      asset.reviews || 0,
      reviewOptions
    );

    // Update global memory
    const lemmaKey = asset.lemma;
    if (plugin.settings.wordAssets[lemmaKey]) {
      plugin.settings.wordAssets[lemmaKey].nextReviewDate = nextReviewDate;
      plugin.settings.wordAssets[lemmaKey].interval = interval;
      plugin.settings.wordAssets[lemmaKey].ease = ease;
      plugin.settings.wordAssets[lemmaKey].reviews = reviews;
      plugin.settings.wordAssets[lemmaKey].reviewTimeMs = (plugin.settings.wordAssets[lemmaKey].reviewTimeMs || 0) + timeSpent;

      // Update daily word review statistics
      const today = new Date().toLocaleDateString("en-CA");
      if (!plugin.settings.wordReviewStats) {
        plugin.settings.wordReviewStats = {};
      }
      if (!plugin.settings.wordReviewStats[today]) {
        plugin.settings.wordReviewStats[today] = { reviewCount: 0, reviewTimeMs: 0 };
      }
      plugin.settings.wordReviewStats[today].reviewCount += 1;
      plugin.settings.wordReviewStats[today].reviewTimeMs += timeSpent;

      await plugin.persistWordAssetSidecar("save");
      await plugin.saveSettings();
    }

    setShowAnswer(false);
    setCurrentIndex(currentIndex + 1);
    onAssetUpdate();
  };

  // Preview next intervals for buttons
  const hardStats = calculateNextReview("Hard", asset.interval || 0, asset.ease || startingEase, asset.reviews || 0, reviewOptions);
  const goodStats = calculateNextReview("Good", asset.interval || 0, asset.ease || startingEase, asset.reviews || 0, reviewOptions);
  const easyStats = calculateNextReview("Easy", asset.interval || 0, asset.ease || startingEase, asset.reviews || 0, reviewOptions);

  const formatInterval = (days: number) => {
    if (days < 30) return `${days}天`;
    if (days < 365) return `${(days / 30).toFixed(1)}个月`;
    return `${(days / 365).toFixed(1)}年`;
  };

  const isSentence = asset.kind === "sentence";
  const displayWord = isSentence ? (asset.sources?.[0]?.quote || asset.lemma) : asset.lemma;
  const posText = asset.partOfSpeech ? `[${asset.partOfSpeech}] ` : "";
  const typeLabel = asset.kind === "sentence" ? "长句" : asset.kind === "phrase" ? "短语" : "单词";
  const titleFontSize = asset.kind === "sentence" ? "1.6em" : displayWord.length > 15 ? "2em" : "3em";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--background-primary)", padding: "32px", maxWidth: "800px", margin: "0 auto", width: "100%", alignItems: "center", justifyContent: "center" }}>
      {/* Header bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", maxWidth: "580px", marginBottom: "24px" }}>
        <button onClick={onComplete} className="jarvis-library-back-btn" aria-label="返回词条">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          返回词条
        </button>
        <div style={{ color: "var(--text-muted)", fontSize: "0.9em", fontWeight: "bold" }}>
          {currentIndex + 1} / {dueAssets.length}
        </div>
      </div>

      {/* Main card area (3D Card Flip Mode) */}
      <div key={currentIndex} className="jarvis-flashcard-container" onClick={() => !showAnswer && setShowAnswer(true)}>
        <div className={`jarvis-flashcard ${showAnswer ? "is-flipped" : ""}`}>
          
          {/* Front Face */}
          <div className="jarvis-flashcard-front" style={{ display: "flex", flexDirection: "column", position: "relative", height: "100%" }}>
            {/* Top Bar: Type Label & Tags (Left), Mastery (Right) */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%", padding: "24px", boxSizing: "border-box" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "8px", flex: 1, minWidth: 0, paddingRight: "16px" }}>
                <div style={{ fontSize: "0.9em", color: "var(--text-muted)", background: "var(--background-secondary)", padding: "4px 12px", borderRadius: "8px" }}>
                  {posText}{typeLabel}
                </div>
                {asset.isWord && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                    {asset.oxford === 1 && (
                      <span className="jarvis-tag" style={{ background: "color-mix(in srgb, var(--color-blue) 20%, transparent)", color: "var(--color-blue)", border: "1px solid color-mix(in srgb, var(--color-blue) 40%, transparent)", fontSize: "0.8em", padding: "2px 8px", borderRadius: "12px" }}>牛津核心</span>
                    )}
                    {asset.collins && asset.collins > 0 && (
                      <span className="jarvis-tag" style={{ background: "color-mix(in srgb, var(--color-yellow) 20%, transparent)", color: "var(--color-yellow)", border: "1px solid color-mix(in srgb, var(--color-yellow) 40%, transparent)", fontSize: "0.8em", padding: "2px 8px", borderRadius: "12px" }}>{'★'.repeat(asset.collins)}</span>
                    )}
                    {asset.tags?.map((tag: string) => (
                      <span key={tag} className="jarvis-tag" style={{ background: "color-mix(in srgb, var(--color-green) 15%, transparent)", color: "var(--color-green)", fontSize: "0.8em", padding: "2px 8px", borderRadius: "12px", border: "1px solid color-mix(in srgb, var(--color-green) 40%, transparent)" }}>{tag.toUpperCase()}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Mastery Button */}
              <div style={{ flexShrink: 0 }}>
                <button 
                  className="clickable-icon" 
                  onClick={async (e) => {
                    e.stopPropagation();
                    const current = asset.mastered;
                    if (plugin.settings.wordAssets[asset.lemma]) {
                      plugin.settings.wordAssets[asset.lemma].mastered = !current;
                      await plugin.persistWordAssetSidecar("save");
                      await plugin.saveSettings();
                      onAssetUpdate();
                    }
                  }} 
                  aria-label={asset.mastered ? "标记为未掌握" : "标记为已掌握"} 
                  style={{ 
                    color: asset.mastered ? "var(--color-green)" : "var(--text-faint)", 
                    width: "28px",
                    height: "28px",
                    padding: "0", 
                    border: asset.mastered ? "1px solid var(--color-green)" : "1px solid var(--text-faint)", 
                    borderRadius: "50%", 
                    display: "flex", 
                    alignItems: "center", 
                    justifyContent: "center" 
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                </button>
              </div>
            </div>

            {/* Center: Word + Audio Icon */}
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", width: "100%" }}>
              <div style={{ position: "relative", display: "inline-flex", alignItems: isSentence ? "flex-start" : "center", justifyContent: "center", width: isSentence ? "100%" : "auto" }}>
                <div style={{ fontSize: titleFontSize, fontFamily: "serif", fontWeight: "bold", textAlign: isSentence ? "left" : "center", lineHeight: 1.4, padding: "0 20px", width: "100%", wordBreak: "break-word", whiteSpace: "pre-wrap", color: "var(--text-normal)" }}>{displayWord}</div>
                {!isSentence && (
                  <div style={{ position: "absolute", left: "100%" }}>
                    <button className="clickable-icon" onClick={(e) => { e.stopPropagation(); playAudio(displayWord); }} aria-label="发音" title="发音" style={{ opacity: 0.7 }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom: Helper Text */}
            <div style={{ padding: "24px", display: "flex", justifyContent: "center", width: "100%", boxSizing: "border-box" }}>
              <button className="mod-cta" onClick={(e) => { e.stopPropagation(); setShowAnswer(true); }}>查看释义</button>
            </div>
          </div>

          {/* Back Face */}
          <div className="jarvis-flashcard-back" onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexDirection: "column" }}>
            {/* Header: Title + Phonetic */}
            <div style={{ display: "flex", flexDirection: "column", marginBottom: "20px", flexShrink: 0, borderLeft: "4px solid var(--interactive-accent)", borderRadius: "8px", paddingLeft: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ fontSize: isSentence ? "1.3em" : "2.2em", fontFamily: "serif", fontWeight: "bold", lineHeight: 1.3, color: "var(--text-normal)" }}>{displayWord}</div>
                {!isSentence && (
                  <button className="clickable-icon" onClick={() => playAudio(displayWord)} aria-label="发音" title="发音" style={{ opacity: 0.7 }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>
                  </button>
                )}
              </div>
              {!isSentence && asset.phonetic && (
                <div style={{ fontSize: "1em", color: "var(--text-muted)", fontStyle: "italic", marginTop: "4px" }}>
                  {asset.phonetic}
                </div>
              )}
              {asset.isWord && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "8px" }}>
                  {asset.oxford === 1 && (
                    <span className="jarvis-tag" style={{ background: "color-mix(in srgb, var(--color-blue) 20%, transparent)", color: "var(--color-blue)", border: "1px solid color-mix(in srgb, var(--color-blue) 40%, transparent)", fontSize: "0.75em", padding: "1px 6px", borderRadius: "12px" }}>牛津核心</span>
                  )}
                  {asset.collins && asset.collins > 0 && (
                    <span className="jarvis-tag" style={{ background: "color-mix(in srgb, var(--color-yellow) 20%, transparent)", color: "var(--color-yellow)", border: "1px solid color-mix(in srgb, var(--color-yellow) 40%, transparent)", fontSize: "0.75em", padding: "1px 6px", borderRadius: "12px" }}>{'★'.repeat(asset.collins)}</span>
                  )}
                  {asset.tags?.map((tag: string) => (
                    <span key={tag} className="jarvis-tag" style={{ background: "color-mix(in srgb, var(--color-green) 15%, transparent)", color: "var(--color-green)", fontSize: "0.75em", padding: "1px 6px", borderRadius: "12px", border: "1px solid color-mix(in srgb, var(--color-green) 40%, transparent)" }}>{tag.toUpperCase()}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Context Quote */}
            {!isSentence && asset.sources && asset.sources[0]?.quote && asset.sources[0].quote.trim() !== asset.lemma.trim() && asset.sources[0].quote.trim() !== displayWord.trim() && (
              <div style={{ marginBottom: "16px", padding: "12px 16px", background: "var(--background-secondary)", borderRadius: "8px", borderLeft: "4px solid var(--interactive-accent)", flexShrink: 0 }}>
                 <div style={{ fontStyle: "italic", color: "var(--text-normal)", fontSize: "0.95em", lineHeight: 1.5 }}>
                   {asset.sources[0].quote}
                 </div>
              </div>
            )}

            {/* Markdown Translation Preview */}
            <div style={{ fontSize: "1.05em", lineHeight: 1.6, flex: "1 1 auto", color: "var(--text-normal)", minHeight: "min-content" }}>
               <MarkdownPreview content={(asset.display || asset.translation || "").replace(/\\n/g, '\n')} plugin={plugin} />
            </div>

            {/* Source Footer */}
            {asset.sources && asset.sources[0] && (
              <div style={{ marginTop: "20px", paddingTop: "12px", borderTop: "1px dashed var(--background-modifier-border)", color: "var(--text-muted)", fontSize: "0.85em", display: "flex", justifyContent: "space-between", flexShrink: 0 }}>
                 <span>来源</span>
                 <span>{asset.sources[0].bookTitle || asset.sources[0].bookPath} {asset.sources[0].chapterTitle ? ` · ${asset.sources[0].chapterTitle}` : ""}</span>
              </div>
            )}

            {/* Bottom Back Button */}
            <div style={{ marginTop: "24px", display: "flex", justifyContent: "center", gap: "16px", flexShrink: 0 }}>
              <button className="jarvis-library-back-btn" onClick={(e) => { e.stopPropagation(); setShowAnswer(false); }}>回到正面</button>
              {asset.sources && asset.sources[0] && asset.sources[0].bookPath && (
                <button className="jarvis-library-btn btn-primary" onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const source = asset.sources[0];
                    if (!source || !source.bookPath) {
                      new Notice("没有找到原文来源");
                      return;
                    }
                    const file = plugin.app.vault.getAbstractFileByPath(source.bookPath);
                    if (!file) {
                      new Notice("找不到书籍文件: " + source.bookPath);
                      return;
                    }
                    // Find an existing leaf with this book open
                    const leaves: any[] = [];
                    plugin.app.workspace.iterateAllLeaves((l) => {
                      if (l.view?.getViewType() === "epub") {
                        leaves.push(l);
                      }
                    });
                    
                    let targetLeaf: any = null;
                    for (const l of leaves) {
                      const viewState = l.getViewState();
                      const filePath = (l.view as any)?.file?.path || viewState?.state?.file;
                      if (filePath === file.path) {
                        targetLeaf = l;
                        break;
                      }
                    }

                    if (targetLeaf) {
                      console.log(`[Jarvis Reader] Found target leaf for book: ${file.path}, jumping to cfi: ${source.cfiRange}`);
                      
                      // Save to settings as a fallback in case view reloads or isn't fully ready
                      plugin.settings.bookInitLocations[file.path] = source.cfiRange;
                      
                      // Set ephemeral state (Obsidian native mechanism)
                      targetLeaf.setEphemeralState({ epubcifi: source.cfiRange });
                      
                      const jump = () => {
                        const view = targetLeaf.view as any;
                        if (view && view.currentRendition) {
                          try {
                            if (typeof view.currentRendition.resize === "function") {
                              view.currentRendition.resize();
                            }
                            view.currentRendition.display(source.cfiRange);
                          } catch (e) {
                            console.warn("[Jarvis Reader] Direct display failed", e);
                          }
                        }
                      };

                      const onActiveLeafChange = (activeLeaf: any) => {
                        const activeView = activeLeaf?.view;
                        const isMatch = activeLeaf === targetLeaf || 
                          (activeView && activeView.getViewType() === "epub" && (activeView as any).file?.path === file.path);
                          
                        if (isMatch) {
                          plugin.app.workspace.off("active-leaf-change", onActiveLeafChange);
                          clearTimeout(safetyTimeout);
                          
                          // Execute multiple display retries to ensure we override Obsidian's tab switch position restoration
                          setTimeout(jump, 150);
                          setTimeout(jump, 400);
                          setTimeout(jump, 800);
                        }
                      };
                      
                      const safetyTimeout = setTimeout(() => {
                        plugin.app.workspace.off("active-leaf-change", onActiveLeafChange);
                        console.log("[Jarvis Reader] active-leaf-change listener timeout triggered");
                        // Fallback jump anyway
                        jump();
                      }, 2500);
                      
                      plugin.app.workspace.on("active-leaf-change", onActiveLeafChange);
                      plugin.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
                    } else {
                      console.log(`[Jarvis Reader] Target leaf not found, opening in a new leaf: ${file.path}`);
                      const newLeaf = plugin.app.workspace.getLeaf(true);
                      await newLeaf.openFile(file as any, { active: true, eState: { epubcifi: source.cfiRange } });
                    }
                  } catch (err) {
                    new Notice("跳转失败: " + String(err));
                    console.error("Jump to source failed", err);
                  }
                }}>跳转原文</button>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Action buttons (Only visible when answered) */}
      <div style={{ display: "flex", gap: "20px", marginTop: "32px", justifyContent: "center", width: "100%", maxWidth: "580px", visibility: showAnswer ? "visible" : "hidden" }}>
        <button 
          style={{ flex: 1, padding: "14px 20px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: "6px", background: "color-mix(in srgb, var(--color-red) 6%, transparent)", color: "var(--color-red)", border: "1px solid color-mix(in srgb, var(--color-red) 25%, transparent)", borderRadius: "12px", cursor: "pointer", transition: "all 0.15s ease", boxShadow: "0 2px 8px color-mix(in srgb, var(--color-red) 5%, transparent)" }}
          onClick={() => handleReview("Hard")}
          onMouseEnter={e => { e.currentTarget.style.background = "var(--color-red)"; e.currentTarget.style.color = "white"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "color-mix(in srgb, var(--color-red) 6%, transparent)"; e.currentTarget.style.color = "var(--color-red)"; }}
        >
          <span style={{ fontWeight: "600", fontSize: "1.1em", letterSpacing: "1px" }}>困难</span>
          <span style={{ fontSize: "0.9em", opacity: 0.85, fontWeight: "500" }}>({formatInterval(hardStats.interval)})</span>
        </button>
        
        <button 
          style={{ flex: 1, padding: "14px 20px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: "6px", background: "color-mix(in srgb, var(--color-blue) 6%, transparent)", color: "var(--color-blue)", border: "1px solid color-mix(in srgb, var(--color-blue) 25%, transparent)", borderRadius: "12px", cursor: "pointer", transition: "all 0.15s ease", boxShadow: "0 2px 8px color-mix(in srgb, var(--color-blue) 5%, transparent)" }}
          onClick={() => handleReview("Good")}
          onMouseEnter={e => { e.currentTarget.style.background = "var(--color-blue)"; e.currentTarget.style.color = "white"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "color-mix(in srgb, var(--color-blue) 6%, transparent)"; e.currentTarget.style.color = "var(--color-blue)"; }}
        >
          <span style={{ fontWeight: "600", fontSize: "1.1em", letterSpacing: "1px" }}>良好</span>
          <span style={{ fontSize: "0.9em", opacity: 0.85, fontWeight: "500" }}>({formatInterval(goodStats.interval)})</span>
        </button>
        
        <button 
          style={{ flex: 1, padding: "14px 20px", display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: "6px", background: "color-mix(in srgb, var(--color-green) 6%, transparent)", color: "var(--color-green)", border: "1px solid color-mix(in srgb, var(--color-green) 25%, transparent)", borderRadius: "12px", cursor: "pointer", transition: "all 0.15s ease", boxShadow: "0 2px 8px color-mix(in srgb, var(--color-green) 5%, transparent)" }}
          onClick={() => handleReview("Easy")}
          onMouseEnter={e => { e.currentTarget.style.background = "var(--color-green)"; e.currentTarget.style.color = "white"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "color-mix(in srgb, var(--color-green) 6%, transparent)"; e.currentTarget.style.color = "var(--color-green)"; }}
        >
          <span style={{ fontWeight: "600", fontSize: "1.1em", letterSpacing: "1px" }}>简单</span>
          <span style={{ fontSize: "0.9em", opacity: 0.85, fontWeight: "500" }}>({formatInterval(easyStats.interval)})</span>
        </button>
      </div>
    </div>
  );
}


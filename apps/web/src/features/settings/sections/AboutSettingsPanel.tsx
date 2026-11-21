import { Download, ExternalLink, FolderOpen, Github, RefreshCw } from "lucide-react";
import { useState } from "react";
import { APP_VERSION } from "@/app/app-version";
import logoUrl from "@/assets/openbuddy-logo.png";
import { openUrl, revealInFolder } from "@openbuddy/client/api/files";
import { updateCheck, updateDownload, type UpdateDownloadResult, type UpdateResult } from "@openbuddy/client/api/update";
import { useLocale } from "../../../shared/i18n";
import { SectionShell } from "./shared";

/**
 * 关于 (20261116-pii W6.3 / A3)：版本、引擎与更新检查。
 * 「检查更新」是真实请求：宿主读取 OPENBUDDY_UPDATE_FEED 的发布清单，
 * 没有配置时明确显示未配置，不伪造结果，也不会静默安装。
 */
const ENGINE_PACKAGE = "@earendil-works/pi-coding-agent";

const REASON: Record<string, string> = {
  update_feed_unconfigured: "未配置更新源（OPENBUDDY_UPDATE_FEED）",
  invalid_feed_url: "更新源地址无效",
  insecure_feed_url: "更新源必须使用 HTTPS（本机调试除外）",
  update_feed_timeout: "更新源连接超时",
  update_feed_http_404: "更新清单不存在（404）",
  update_channel_mismatch: "更新通道不匹配",
  invalid_manifest: "更新清单格式不正确",
  invalid_manifest_version: "更新清单版本号无效",
  invalid_manifest_download: "更新清单缺少下载地址",
  invalid_manifest_sha256: "更新清单校验值无效",
  invalid_manifest_json: "更新清单不是有效 JSON",
  update_manifest_too_large: "更新清单过大",
  update_download_failed: "下载失败，请检查网络后重试",
  update_download_timeout: "下载超时",
  update_download_empty: "下载内容为空",
  update_download_too_large: "安装包超过大小上限",
  update_size_mismatch: "安装包大小与清单不一致，已删除下载文件",
  update_checksum_mismatch: "安装包校验失败，已删除下载文件",
};
const explain = (error: unknown) => {
  const message = String(error instanceof Error ? error.message : error).replace(/^Error:\s*/, "");
  return REASON[message] ?? message.replace(/^update_(?:feed|download)_http_/, "更新源返回 HTTP ");
};

export function AboutSettingsPanel() {
  const { t } = useLocale();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState<UpdateDownloadResult | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const check = async () => {
    setChecking(true);
    setStatus(null);
    setResult(null);
    setDownloaded(null);
    setDownloadError(null);
    try {
      const next = await updateCheck();
      setResult(next);
      setStatus(next.status === "available" ? t("about.available", { version: next.version }) : t("about.upToDate", { version: next.currentVersion }));
    } catch (error) {
      setStatus(explain(error));
    } finally {
      setChecking(false);
    }
  };

  const download = async () => {
    if (!result || result.status !== "available" || downloading) return;
    setDownloading(true);
    setDownloadError(null);
    setDownloaded(null);
    try {
      setDownloaded(await updateDownload(result.download));
    } catch (error) {
      setDownloadError(explain(error));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <SectionShell title={t("about.title")} desc={t("about.desc")}>
      <div className="about-card">
        <div className="about-card__brand">
          <img className="about-card__logo" src={logoUrl} alt="" width={46} height={46} />
          <div>
            <div className="about-card__name">OpenBuddy</div>
            <div className="about-card__version">v{APP_VERSION} · {t("about.tagline")}</div>
          </div>
        </div>
        <dl className="about-card__facts">
          <div>
            <dt>{t("about.engine")}</dt>
            <dd>
              <code>{ENGINE_PACKAGE}</code>
            </dd>
          </div>
          <div>
            <dt>{t("about.update")}</dt>
            <dd>
              <button type="button" className="sec-btn" onClick={() => void check()} disabled={checking}>
                <RefreshCw size={14} /> {checking ? t("about.checking") : t("about.check")}
              </button>
              {status && <span className="about-card__status" role="status">{status}</span>}
            </dd>
          </div>
          <div>
            <dt>{t("about.license")}</dt>
            <dd>{t("about.licenseValue")}</dd>
          </div>
          <div>
            <dt>{t("about.docs")}</dt>
            <dd>
              <a href="https://github.com/badlogic/pi-mono/" target="_blank" rel="noreferrer">
                <ExternalLink size={12} /> Pi SDK
              </a>
            </dd>
          </div>
          <div>
            <dt>{t("about.feedback")}</dt>
            <dd>
              {t("about.feedbackValue")}<Github size={12} />
            </dd>
          </div>
        </dl>
        {result?.status === "available" && (
          <div className="about-card__update" role="region" aria-label="可用更新">
            <div className="about-card__update-head">
              <strong>v{result.version}</strong>
              {result.publishedAt && <span>{new Date(result.publishedAt).toLocaleDateString()}</span>}
              <span>{result.channel === "beta" ? t("about.channel.beta") : t("about.channel.stable")}</span>
            </div>
            {result.notes && <p className="about-card__notes">{result.notes}</p>}
            <div className="about-card__actions">
              <button type="button" className="sec-btn sec-btn--ink" onClick={() => void download()} disabled={downloading}>
                <Download size={14} /> {downloading ? t("about.downloading") : t("about.downloadInstaller")}
              </button>
              <button type="button" className="sec-btn" onClick={() => void openUrl(result.download.url)}>
                <ExternalLink size={14} /> {t("about.download")}
              </button>
            </div>
            {downloadError && <p className="sec-error" role="alert">{downloadError}</p>}
            {downloaded && (
              <div className="about-card__downloaded">
                <p className="about-card__status" role="status">
                  {t("about.downloaded")} · {downloaded.bytes} B · sha256 {downloaded.sha256.slice(0, 12)}…
                </p>
                <p className="sec-footnote about-card__path">{downloaded.path}</p>
                <button type="button" className="sec-btn" onClick={() => void revealInFolder(downloaded.path)}>
                  <FolderOpen size={14} /> {t("about.openFolder")}
                </button>
              </div>
            )}
            <p className="sec-footnote">{t("about.downloadReady")}</p>
          </div>
        )}
      </div>
    </SectionShell>
  );
}

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Check, Copy, Download, ExternalLink, FlaskConical, Globe, Laptop, Server, ShieldCheck, Smartphone, type LucideIcon } from 'lucide-react';
import { BlurFade, GithubIcon, SpotlightCard } from './primitives';
import type { DownloadEntry, DownloadGroup, OsId } from '@/lib/downloads';
import { REPO_URL, RELEASES_URL } from '@/lib/site';
import { dict, type Dict, type Lang } from '@/i18n';

const GROUP_ICON: Record<DownloadGroup['id'], LucideIcon> = { server: Server, desktop: Laptop, mobile: Smartphone };

function detectOs(): OsId | null {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/windows/i.test(ua)) return 'windows';
  if (/mac/i.test(ua)) return 'macos';
  if (/linux|x11/i.test(ua)) return 'linux';
  return null;
}

function Row({ e, recommended, d }: { e: DownloadEntry; recommended: boolean; d: Dict['download'] }) {
  const [copied, setCopied] = useState(false);
  const cls = `row ${recommended ? 'rec' : ''}`;
  const meta = copied ? d.copiedHint : e.available ? e.meta : d.releases;
  const body = (
    <>
      <span className="rl">{e.label}{recommended && <span className="rec-tag">{d.yourOs}</span>}</span>
      <span className="rm">{meta}</span>
      {e.copy ? (copied ? <Check size={14} /> : <Copy size={14} />) : <Download size={14} />}
    </>
  );
  if (e.copy) {
    const text = e.copy;
    return (
      <button type="button" className={cls} style={{ cursor: 'pointer', font: 'inherit', color: 'inherit', textAlign: 'start' }} onClick={async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard denied */ }
      }}>{body}</button>
    );
  }
  return (
    <a className={cls} href={e.href} {...(e.available ? { download: true } : { target: '_blank', rel: 'noopener noreferrer' })}>{body}</a>
  );
}

/**
 * Download matrix. The visitor's OS is detected on the client and its rows are highlighted.
 * Assets resolve at build time; entries without a published asset link to the releases page.
 */
export default function Downloads({ groups, tag, lang }: { groups: DownloadGroup[]; tag: string | null; lang: Lang }) {
  const d = dict(lang).download;
  const beta = dict(lang).beta;
  const [os, setOs] = useState<OsId | null>(null);
  useEffect(() => setOs(detectOs()), []);

  return (
    <>
      <div className="beta-note" role="note">
        <FlaskConical />
        <div><b>{beta.title}.</b> {beta.text}</div>
      </div>
      <div className="dl">
        {groups.map((g, i) => {
          const Icon = GROUP_ICON[g.id];
          const m = d[g.id];
          return (
            <BlurFade key={g.id} delay={i * 0.07}>
              <SpotlightCard className="dl-card">
                <h3><Icon />{m.title}</h3>
                <p>{m.text}</p>
                <div className="rows">
                  {g.entries.map((e) => <Row key={e.id} e={e} d={d} recommended={os !== null && e.os === os} />)}
                  {g.id === 'desktop' && (
                    <a className="row" href={`${REPO_URL}#quick-start`}><span className="rl"><Globe />{d.webClient}</span><span className="rm">{d.webClientMeta}</span><ExternalLink size={14} /></a>
                  )}
                  {g.id === 'mobile' && (
                    <div className="row soon"><span className="rl">{d.ios}</span><span className="rm">{d.soon}</span></div>
                  )}
                </div>
              </SpotlightCard>
            </BlurFade>
          );
        })}
      </div>
      <motion.div className="dl-foot" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}>
        <span>{tag ? <>{d.latest} <span className="mono">{tag}</span></> : d.onGithub}</span>
        <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer"><ExternalLink />{d.all}</a>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer"><GithubIcon size={14} />{d.source}</a>
        <a href={`${RELEASES_URL}/latest`} target="_blank" rel="noopener noreferrer"><ShieldCheck />{d.verify}</a>
      </motion.div>
    </>
  );
}

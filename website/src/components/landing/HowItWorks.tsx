import { useState } from 'react';
import { Info } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { BlurFade } from './primitives';
import CoveFlow from './CoveFlow';
import { dict, type Lang } from '@/i18n';

const STEP_MS = 3200;

/**
 * Three-step diagram (client, server, members). The Stageshow scene plays the journey and reports which
 * step it is on, so the matching step card below lights up and fills a progress bar.
 */
export default function HowItWorks({ lang }: { lang: Lang }) {
  const d = dict(lang).how;
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);

  return (
    <div className="hiw">
      <BlurFade>
        <div className="hiw-stage hiw-stage--scene">
          <CoveFlow lang={lang} onStep={setStep} />
        </div>
      </BlurFade>

      <div className="hiw-steps">
        {d.steps.map((s, i) => (
          <div key={s.title} className={`hiw-step ${step === i ? 'active' : ''}`}>
            <span className="num">0{i + 1}</span>
            <b>{s.title}</b>
            <p>{s.text}</p>
            {step === i && !reduce && (
              <motion.span key={`${step}`} className="prog" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: STEP_MS / 1000, ease: 'linear' }} />
            )}
          </div>
        ))}
      </div>

      <BlurFade delay={0.1}>
        <div className="note">
          <Info />
          <div><b>{d.noteStrong}</b> {d.note}</div>
        </div>
      </BlurFade>
    </div>
  );
}

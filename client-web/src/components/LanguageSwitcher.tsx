import { useTranslation } from 'react-i18next';
import { RTL_LANGUAGES } from '@/i18n';

const LANGUAGES = [
	{ code: 'en', label: 'English', flag: '🇬🇧' },
	{ code: 'fa', label: 'فارسی', flag: '🇮🇷' },
	{ code: 'ar', label: 'العربية', flag: '🇸🇦' },
];

export default function LanguageSwitcher() {
	const { i18n } = useTranslation();

	const handleChange = (code: string) => {
		i18n.changeLanguage(code);
		localStorage.setItem('cove_lang', code);
	};

	return (
		<div style={{ display: 'flex', gap: 4 }}>
			{LANGUAGES.map((lang) => (
				<button
					key={lang.code}
					id={`lang-btn-${lang.code}`}
					onClick={() => handleChange(lang.code)}
					title={lang.label}
					aria-label={`Switch to ${lang.label}`}
					style={{
						background:
							i18n.language === lang.code
								? 'var(--color-bg-active)'
								: 'transparent',
						border: `1px solid ${i18n.language === lang.code ? 'var(--color-brand)' : 'var(--color-border)'}`,
						borderRadius: 'var(--radius-sm)',
						padding: '3px 7px',
						cursor: 'pointer',
						fontSize: '13px',
						color:
							i18n.language === lang.code
								? 'var(--color-text-primary)'
								: 'var(--color-text-muted)',
						transition: 'all var(--transition)',
						direction: RTL_LANGUAGES.has(lang.code) ? 'rtl' : 'ltr',
					}}
				>
					{lang.flag} {lang.code.toUpperCase()}
				</button>
			))}
		</div>
	);
}

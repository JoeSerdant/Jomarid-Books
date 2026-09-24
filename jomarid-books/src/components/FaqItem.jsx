import { useState } from 'react';
import { HelpCircle, ChevronDown } from 'lucide-react';

export const FaqItem = ({ question, answer }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div 
      style={{ borderColor: 'var(--border-color)' }} 
      className="border-b last:border-b-0 text-left py-4"
    >
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        style={{ color: 'var(--text-body)' }}
        className="w-full flex justify-between items-center bg-transparent border-none outline-none cursor-pointer font-black uppercase text-xs tracking-wider text-left py-2 gap-4 group"
      >
        <span className="flex items-center gap-2.5">
          <HelpCircle 
            size={14} 
            style={{ color: 'var(--bg-primary)' }} 
            className="shrink-0 opacity-80 group-hover:opacity-100 transition-opacity" 
          />
          {question}
        </span>
        <ChevronDown 
          size={16} 
          style={{ color: 'var(--text-muted)' }}
          className={`transform transition-transform duration-300 shrink-0 ${isOpen ? 'rotate-180' : ''}`} 
        />
      </button>

      {/* Plynulá vysunovací animace bez trhání přes CSS Grid trick */}
      <div 
        className={`grid transition-all duration-300 ease-in-out ${
          isOpen ? 'grid-rows-[1fr] opacity-100 pt-2 pb-1' : 'grid-rows-[0fr] opacity-0 overflow-hidden'
        }`}
      >
        <div className="overflow-hidden">
          <p 
            style={{ color: 'var(--text-muted)' }} 
            className="text-xs font-medium leading-relaxed pl-6"
          >
            {answer}
          </p>
        </div>
      </div>
    </div>
  );
};


import { useState } from "react";
import { Button, Field, Input, Modal, showError, useToast } from "@/components/ui";
import { measurementRepo } from "@/db/repositories";
import { todayStr } from "@/db/client";

/** 腰围弹窗（S04 / FR-REC-02）：30–200 cm，0.5 步进。 */
export function WaistModal({ userId, onClose, onSaved }: {
  userId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { show } = useToast();
  const [waist, setWaist] = useState("");
  const save = async () => {
    try {
      const cm = Number(waist);
      if (!Number.isFinite(cm) || cm < 30 || cm > 200) throw new Error("腰围须在 30–200 cm 之间");
      // 只更新腰围：读取当天记录，若无则写一条仅含腰围需满足 weight NOT NULL，故提示先记体重
      const latest = await measurementRepo.latest(userId);
      if (!latest) throw new Error("请先记录一次体重，再补腰围");
      await measurementRepo.saveOnDate(userId, todayStr(), latest.weight_kg, cm);
      onSaved?.();
      onClose();
    } catch (e) {
      showError(e, show);
    }
  };
  return (
    <Modal
      title="记腰围"
      onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>取消</Button><Button onClick={save}>保存</Button></>}
    >
      <Field label="腰围（cm）" hint="30–200 cm，±0.5；每周提示一次">
        <Input autoFocus type="number" step="0.5" min={30} max={200} value={waist} onChange={(e) => setWaist(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
      </Field>
    </Modal>
  );
}

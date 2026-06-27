"use client";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import Image from "next/image";
import { useId, useState, useTransition, type ReactNode } from "react";

import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Input, Textarea, Toggle } from "@/app/components/ui/form";
import { Dialog } from "@/app/components/ui/dialog";
import { Toast } from "@/app/components/ui/toast";
import { ImageUpload } from "@/app/components/upload/image-upload";
import {
  createProduct,
  deleteProduct,
  setProductActive,
  updateProduct
} from "@/lib/actions/products";
import { EMPTY_STATES } from "@/lib/copy/empty-states";
import type { Product } from "@/lib/schemas/product";
import { cn } from "@/lib/utils/cn";
import { formatMoney, formatPrice } from "@/lib/pricing/currency";
import { parsePriceToCents } from "@/lib/utils/price";

const ALLERGEN_OPTIONS = ["wheat", "dairy", "eggs", "nuts", "soy", "sesame"];
const TILE_TINTS = ["bg-verdigris-3", "bg-marigold-3", "bg-teal-3", "bg-info-3"];

function tintFor(id: string): string {
  let hash = 0;
  for (const ch of id) {
    hash = (hash + ch.charCodeAt(0)) % TILE_TINTS.length;
  }
  return TILE_TINTS[hash] ?? "bg-paper-3";
}

export function ProductsScreen({
  initialProducts,
  storeId
}: {
  initialProducts: Product[];
  storeId: string;
}) {
  const [products, setProducts] = useState(initialProducts);
  const [editing, setEditing] = useState<Product | "new" | null>(null);

  const activeCount = products.filter((p) => p.is_active).length;

  function upsert(product: Product) {
    setProducts((prev) => {
      const exists = prev.some((p) => p.id === product.id);
      return exists
        ? prev.map((p) => (p.id === product.id ? product : p))
        : [product, ...prev];
    });
  }

  return (
    <section className="mx-auto max-w-4xl">
      <div className="mb-5 flex items-center gap-4">
        <div>
          <h1 className="font-display text-36 leading-none text-ink">Products</h1>
          <p className="mt-1.5 font-mono text-12 tracking-[0.04em] text-ink-3">
            {activeCount} active · {products.length} total
          </p>
        </div>
        <div className="flex-1" />
        <Button onClick={() => setEditing("new")}>
          <Plus aria-hidden="true" />
          Add product
        </Button>
      </div>

      {products.length === 0 ? (
        <EmptyState
          title={EMPTY_STATES.products.title}
          body={EMPTY_STATES.products.body}
          action={
            <Button onClick={() => setEditing("new")}>
              <Plus aria-hidden="true" />
              Add product
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border border-line bg-surface shadow-sm">
          {products.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              onEdit={() => setEditing(product)}
              onChanged={upsert}
              onDeleted={(id) => setProducts((prev) => prev.filter((p) => p.id !== id))}
            />
          ))}
        </div>
      )}

      {editing ? (
        <ProductModal
          storeId={storeId}
          product={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(product) => {
            upsert(product);
            setEditing(null);
          }}
        />
      ) : null}
    </section>
  );
}

function ProductRow({
  onChanged,
  onDeleted,
  onEdit,
  product
}: {
  onChanged: (product: Product) => void;
  onDeleted: (id: string) => void;
  onEdit: () => void;
  product: Product;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggleActive() {
    const next = !product.is_active;
    onChanged({ ...product, is_active: next }); // optimistic
    startTransition(async () => {
      const result = await setProductActive(product.id, next);
      if (!result.ok) {
        onChanged({ ...product, is_active: !next });
        setError("That didn't save — try again.");
      }
    });
  }

  return (
    <div className="grid grid-cols-[48px_1fr_auto_auto_auto_auto] items-center gap-4 border-b border-line px-4 py-3 last:border-b-0">
      <span
        className={cn(
          "relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-md text-16 font-semibold text-ink/70",
          !product.image_url && tintFor(product.id)
        )}
      >
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.image_alt ?? product.name}
            fill
            unoptimized
            className="object-cover"
          />
        ) : (
          product.name.slice(0, 1).toUpperCase()
        )}
      </span>

      <div className="min-w-0">
        <p className="truncate text-14 font-semibold text-ink">{product.name}</p>
        {product.allergens.length > 0 ? (
          <p className="truncate text-12 text-ink-3">
            Contains: {product.allergens.join(", ")}
          </p>
        ) : null}
        {error ? (
          <Toast tone="danger" className="mt-1">
            {error}
          </Toast>
        ) : null}
      </div>

      <span className="text-right font-mono text-14 font-medium text-ink">
        {formatPrice(product.price_cents)}
      </span>

      <span
        className="text-right font-mono text-13 text-ink-2"
        title={product.qty_available === null ? "Unlimited" : undefined}
      >
        {product.qty_available === null ? "∞" : `${product.qty_available} left`}
      </span>

      <Toggle
        checked={product.is_active}
        onChange={toggleActive}
        aria-label={`${product.name} active`}
      />

      <div className="relative">
        <button
          type="button"
          className="rounded-sm px-2 py-1 text-ink-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdigris"
          aria-label="More actions"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
        {menuOpen ? (
          <div
            role="menu"
            className="absolute right-0 top-9 z-10 w-36 rounded-md border border-line bg-surface p-1 shadow-md"
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-14 hover:bg-paper-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdigris"
              onClick={() => {
                setMenuOpen(false);
                onEdit();
              }}
            >
              <Pencil className="h-4 w-4" />
              Edit
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-14 text-danger hover:bg-danger-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdigris"
              onClick={() => {
                setMenuOpen(false);
                if (window.confirm(`Remove "${product.name}" from your stoop?`)) {
                  startTransition(async () => {
                    const result = await deleteProduct(product.id);
                    if (result.ok) {
                      onDeleted(product.id);
                    } else {
                      setError("We couldn't remove that — try again.");
                    }
                  });
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
              Remove
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ProductModal({
  onClose,
  onSaved,
  product,
  storeId
}: {
  onClose: () => void;
  onSaved: (product: Product) => void;
  product: Product | null;
  storeId: string;
}) {
  const formId = useId();
  const [name, setName] = useState(product?.name ?? "");
  const [price, setPrice] = useState(
    product ? formatMoney(product.price_cents) : ""
  );
  const [qty, setQty] = useState(
    product?.qty_available != null ? String(product.qty_available) : ""
  );
  const [maxPerOrder, setMaxPerOrder] = useState(
    product?.max_per_order != null ? String(product.max_per_order) : ""
  );
  const [description, setDescription] = useState(product?.description ?? "");
  const [ingredients, setIngredients] = useState(product?.ingredients ?? "");
  const [allergens, setAllergens] = useState<string[]>(product?.allergens ?? []);
  const [isActive, setIsActive] = useState(product?.is_active ?? true);
  const [imageUrl, setImageUrl] = useState<string | null>(product?.image_url ?? null);
  const [imageAlt, setImageAlt] = useState(product?.image_alt ?? "");
  const [imageUploadId, setImageUploadId] = useState<string | null | undefined>(
    undefined
  );
  const [imageCleared, setImageCleared] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggleAllergen(value: string) {
    setAllergens((prev) =>
      prev.includes(value) ? prev.filter((a) => a !== value) : [...prev, value]
    );
  }

  function handleSave() {
    setErrors({});
    setFormError(null);
    const trimmedQty = qty.trim();
    const trimmedMax = maxPerOrder.trim();
    const input = {
      name: name.trim(),
      description: description.trim() || undefined,
      price_cents: parsePriceToCents(price),
      image_upload_id: imageUploadId ?? undefined,
      clear_image: imageCleared,
      image_alt: imageAlt.trim() || undefined,
      qty_available: trimmedQty === "" ? null : Number.parseInt(trimmedQty, 10),
      max_per_order: trimmedMax === "" ? null : Number.parseInt(trimmedMax, 10),
      is_active: isActive,
      allergens,
      ingredients: ingredients.trim() || undefined
    };

    startTransition(async () => {
      const result = product
        ? await updateProduct(product.id, input)
        : await createProduct(input);
      if (result.ok) {
        onSaved(result.product);
      } else if (result.fieldErrors) {
        setErrors(result.fieldErrors);
      } else {
        setFormError(result.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <Dialog open onClose={onClose} title={product ? "Edit product" : "Add a product"}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-14 font-semibold text-ink">Photo</span>
          {storeId ? (
            <ImageUpload
              storeId={storeId}
              value={imageUrl}
              previewAlt="Product photo"
              onChange={(url, uploadId) => {
                setImageUrl(url);
                setImageUploadId(uploadId);
                setImageCleared(url === null);
              }}
            />
          ) : (
            <p className="text-13 text-ink-3">
              Add a photo after your store is set up.
            </p>
          )}
        </div>

        {imageUrl ? (
          <Field
            id={`${formId}-image-alt`}
            label="Photo description"
            error={errors.image_alt}
          >
            <Input
              id={`${formId}-image-alt`}
              value={imageAlt}
              onChange={(e) => setImageAlt(e.target.value)}
              placeholder="A stack of golden-brown cookies on a plate"
            />
            <span className="mt-1 block text-12 text-ink-3">
              Helps shoppers using a screen reader picture your item.
            </span>
          </Field>
        ) : null}

        <Field id={`${formId}-name`} label="Product name" error={errors.name}>
          <Input
            id={`${formId}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Brown butter cookies"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field id={`${formId}-price`} label="Price" error={errors.price_cents}>
            <Input
              id={`${formId}-price`}
              numeric
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onBlur={() =>
                setPrice(price ? formatMoney(parsePriceToCents(price)) : "")
              }
              placeholder="$12.00"
            />
            <span className="mt-1 block text-12 text-ink-3">
              Leave blank or $0 for a giveaway.
            </span>
          </Field>
          <Field
            id={`${formId}-quantity`}
            label="Quantity"
            error={errors.qty_available}
          >
            <Input
              id={`${formId}-quantity`}
              numeric
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="Blank = unlimited"
            />
          </Field>
        </div>

        <Field
          id={`${formId}-max-per-order`}
          label="Limit per order"
          error={errors.max_per_order}
        >
          <Input
            id={`${formId}-max-per-order`}
            numeric
            value={maxPerOrder}
            onChange={(e) => setMaxPerOrder(e.target.value)}
            placeholder="No limit"
          />
          <span className="mt-1 block text-12 text-ink-3">
            Caps how many one person can grab in a single order — handy for giveaways.
          </span>
        </Field>

        <Field
          id={`${formId}-description`}
          label="Description"
          error={errors.description}
        >
          <Input
            id={`${formId}-description`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell people what you make…"
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <span className="text-14 font-semibold text-ink">Allergens</span>
          <div className="flex flex-wrap gap-1.5">
            {ALLERGEN_OPTIONS.map((option) => {
              const selected = allergens.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => toggleAllergen(option)}
                  aria-pressed={selected}
                  className={cn(
                    "rounded-pill border px-3 py-1 text-12 transition-colors duration-fast ease-stoop",
                    selected
                      ? "border-ink bg-ink text-paper"
                      : "border-line bg-surface text-ink-2 hover:bg-paper-2"
                  )}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>

        <Field
          id={`${formId}-ingredients`}
          label="Ingredients"
          error={errors.ingredients}
        >
          <Textarea
            id={`${formId}-ingredients`}
            value={ingredients}
            onChange={(e) => setIngredients(e.target.value)}
            placeholder="Flour, butter, brown sugar…"
          />
        </Field>

        <label className="flex items-center gap-3">
          <Toggle checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span className="text-14 text-ink">Show on storefront</span>
        </label>

        {formError ? (
          <Toast tone="danger" className="self-start">
            {formError}
          </Toast>
        ) : null}

        <div className="mt-2 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? "Saving…" : "Save product"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function Field({
  children,
  error,
  id,
  label
}: {
  children: ReactNode;
  error?: string;
  id?: string;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {id ? (
        <label htmlFor={id} className="text-14 font-semibold text-ink">
          {label}
        </label>
      ) : (
        <span className="text-14 font-semibold text-ink">{label}</span>
      )}
      {children}
      {error ? <p className="text-13 text-danger">{error}</p> : null}
    </div>
  );
}

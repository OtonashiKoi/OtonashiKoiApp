const { AppError, ERROR_CODES } = require("../../shared/errors");

const VALID_EFFECT_TYPES = ["none", "grant_gold", "grant_diamond", "grant_exp", "grant_status_points", "checkin_multiplier"];

class ItemService {
  constructor(itemRepository) {
    this.itemRepository = itemRepository;
  }

  _normalizeEffect(effect) {
    if (!effect || !VALID_EFFECT_TYPES.includes(effect.type)) return { type: "none", value: 0 };
    return { type: effect.type, value: Math.max(0, Number(effect.value) || 0) };
  }

  async listItems() {
    return this.itemRepository.findAll();
  }

  async getItemById(id) {
    const item = await this.itemRepository.findById(id);
    if (!item) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, `道具不存在: ${id}`, 404);
    return item;
  }

  _normalizeItemType(t) {
    return ["consumable", "collectible", "equipment"].includes(t) ? t : "consumable";
  }

  async createItem({ name, description, itemType, effect, imageUrl, imageThumbnailUrl }) {
    const item = {
      id: crypto.randomUUID(),
      name: String(name || "").trim(),
      description: String(description || "").trim(),
      itemType: this._normalizeItemType(itemType),
      imageUrl: imageUrl || null,
      imageThumbnailUrl: imageThumbnailUrl || null,
      effect: this._normalizeEffect(effect),
      createdAt: new Date().toISOString()
    };
    if (!item.name) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "道具名稱不可空白", 400);
    return this.itemRepository.save(item);
  }

  async updateItem(id, fields) {
    const item = await this.getItemById(id);
    const updated = { ...item };
    if (fields.name !== undefined) updated.name = String(fields.name).trim();
    if (fields.description !== undefined) updated.description = String(fields.description).trim();
    if (fields.itemType !== undefined) updated.itemType = this._normalizeItemType(fields.itemType);
    if (fields.effect !== undefined) updated.effect = this._normalizeEffect(fields.effect);
    if (fields.imageUrl !== undefined) updated.imageUrl = fields.imageUrl;
    if (fields.imageThumbnailUrl !== undefined) updated.imageThumbnailUrl = fields.imageThumbnailUrl;
    if (!updated.name) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "道具名稱不可空白", 400);
    return this.itemRepository.save(updated);
  }

  async deleteItem(id) {
    await this.getItemById(id);
    await this.itemRepository.delete(id);
  }
}

module.exports = { ItemService };

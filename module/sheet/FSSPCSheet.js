export default class FSSPCSheet extends ActorSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            template: "systems/foundryvtt-fire-sword-and-sorcery/template/sheet/pc-sheet.html",
            tabs: [{navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "inventory"}]
        });
    }

    async getData() {
        const data = super.getData();

        data.config = CONFIG.fss;

        data.actor.system.notes = await TextEditor.enrichHTML(data.data.system.notes, {secrets: data.data.owner, async: true});

        const actorItems = Object.keys(data.actor.system.equipped).map(a => {return {[a]: data.actor.system.equipped[a]}});
        const actorEquippedItems = actorItems.filter(a => Object.values(a)[0]);
        const actorEquippedItemIds = actorEquippedItems.map(a => Object.values(a)[0]._id);

        data.actor.system.equippeditems = data.items.filter(item => {
            return item.type === "equipment" && actorEquippedItemIds.includes(item._id);
        });

        data.actor.system.inventory = data.items.filter(item => {
            return item.type === "equipment" && !actorEquippedItemIds.includes(item._id);
        });

        data.actor.system.armourValue = data.actor.system.equippeditems.reduce((accumulator,currentValue) => {
            return accumulator + currentValue.system.armourValue;
        }, 0);

        data.actor.system.facets = data.items.filter(item => item.type === "facet");
        data.actor.system.heritageAbility = data.items.find(item => item.type === "heritageAbility");

        data.actor.system.load = {};
        data.actor.system.load.value = data.items.filter(item => item.type === "equipment").reduce((accumulator, currentValue) => {
            return accumulator + currentValue.system.size;
        }, 0);
        data.actor.system.load.style = data.actor.system.load.value > 10 ? "color: red" : "";
        data.actor.system.load.warning = data.actor.system.load.value > 10 ? "OVER CAPACITY!" : "";

        let maxMagicLevel = 0;
        const primaryElements = ["air","earth","fire","water"];
        const secondaryElements= ["steam","metal","lightning","nature","frost","sand"];
        primaryElements.forEach(e => {
            maxMagicLevel += data.actor.system.magic.elements[e];
        });
        secondaryElements.forEach(e => {
            maxMagicLevel += (data.actor.system.magic.elements[e] * 2);
        });
        data.actor.system.magic.maxMagicLevel = maxMagicLevel;

        let usedMagicLevel=0;
        usedMagicLevel += parseInt(data.actor.system.magic.range);
        usedMagicLevel += parseInt(data.actor.system.magic.area);
        usedMagicLevel += parseInt(data.actor.system.magic.dmghp);
        data.actor.system.magic.usedMagicLevel = usedMagicLevel;

        return data;
    }

    activateListeners(html) {
        html.find(".item-delete").click(this._onItemDelete.bind(this));
        html.find(".item-roll").click(this._onItemRoll.bind(this));
        html.find(".item-unequip").click(this._onItemUnequip.bind(this));
        html.find(".show-item").click(this._onShowItem.bind(this));
        html.find(".equip-item").click(this._onEquipItem.bind(this));
        html.find(".roll-armour").click(this._onRollArmour.bind(this));
        html.find(".magic-add-element").click(this._onMagicAddElement.bind(this));
        html.find(".component-pouch-reset").click(this._onComponentPouchReset.bind(this));

        super.activateListeners(html);
    }

    async _onComponentPouchReset(event) {
        await this.actor.update({"system.magic.componentPouchTracker": 6});
    }

    async _onMagicAddElement(event) {
        const element = event.currentTarget;
        const magicElement = element.dataset.element;

        if (this.actor.system.magic.componentPouchTracker <= 0) {
            return;
        }

        const actorUpdateKey = "system.magic.elements." + magicElement;
        await this.actor.update({[actorUpdateKey]: this.actor.system.magic.elements[magicElement] + 1});
        await this.actor.update({"system.magic.componentPouchTracker": this.actor.system.magic.componentPouchTracker - 1});

        // check for different primary elements and combine
        const secondaryElementDict = {
            air:{
                earth: "sand",
                fire: "lightning",
                water: "frost"
            },
            earth:{
                air: "sand",
                fire: "metal",
                water: "nature"
            },
            fire:{
                air: "lightning",
                earth: "metal",
                water: "steam"
            },
            water:{
                air: "frost",
                earth: "nature",
                fire: "steam"
            }
        };
        
        const elementsToCheck = ["air","earth","fire","water"].filter(a => a != magicElement);
        elementsToCheck.forEach(async e => {
            const elementCount = this.actor.system.magic.elements[e];
            if (elementCount > 0) {
                let actorUpdateKey = "system.magic.elements." + magicElement;
                await this.actor.update({[actorUpdateKey]: this.actor.system.magic.elements[magicElement] - 1});
                actorUpdateKey = "system.magic.elements." + e;
                await this.actor.update({[actorUpdateKey]: this.actor.system.magic.elements[e] - 1});

                const secondaryElement = secondaryElementDict[e][magicElement];
                actorUpdateKey = "system.magic.elements." + secondaryElement;
                await this.actor.update({[actorUpdateKey]: this.actor.system.magic.elements[secondaryElement] + 1});
            }
        });
    }

    async _onRollArmour(event) {
        const element = event.currentTarget;
        const armourValue = parseInt(element.dataset.armourvalue);
        const rollFormula = `1d20 + @armourValue`;

        const rollData = {
            armourValue: armourValue
        };

        const messageData = {
            speaker: ChatMessage.getSpeaker()
        };

        let r = await new Roll(rollFormula, rollData).roll();
        r.toMessage(messageData);
    }

    async _onItemUnequip(event) {
        const equipSlot = event.currentTarget.dataset.equipslot;
        const itemInSlotId = this.actor.system.equipped[equipSlot] && this.actor.system.equipped[equipSlot]._id;
        if (itemInSlotId) {
            const actorUpdateKey = "system.equipped." + equipSlot;
            await this.actor.update({[actorUpdateKey]: false});
        }
    }

    async _onEquipItem(event) {
        const element = $(event.currentTarget).parents(".item");
        const item = this.actor.items.get(element.data("itemId"));
        const equipSlot = event.currentTarget.dataset.equipslot;
        
        // Check if it can be equipped in the slot
        if (!item.system.equippable[equipSlot]) {
            console.log(`FSS | Can't equip ${item.name} in ${equipSlot}`)
            return;
        }

        // Check for item size
        // > 2: Can't be equipped
        // = 2: Can only be equipped in the hands
        if (item.system.size > 2) {
            console.log(`FSS | Can't equip ${item.name} in ${equipSlot} - item is ${item.system.size} slots big`);
            return;
        }
        if (item.system.size === 2 && equipSlot != "hand1" && equipSlot != "hand2") {
            console.log(`FSS | Can't equip ${item.name} in ${equipSlot} - item is 2 slots big, it can only be equipped in the hands`);
            return;
        }
        
        // Unequip any item already in that slot
        const itemInSlotId = this.actor.system.equipped[equipSlot] && this.actor.system.equipped[equipSlot]._id;
        if (itemInSlotId) {
            const actorUpdateKey = "system.equipped." + equipSlot;
            await this.actor.update({[actorUpdateKey]: false});
        }
        // If we are equipping a size 2 item, unequip from both hand slots
        const itemInHand1Id = this.actor.system.equipped.hand1 && this.actor.system.equipped.hand1._id;
        const itemInHand2Id = this.actor.system.equipped.hand2 && this.actor.system.equipped.hand2._id;
        if (item.system.size === 2) {
            if (itemInHand1Id) {
                await this.actor.update({"system.equipped.hand1": false});
            }
            if (itemInHand2Id) {
                await this.actor.update({"system.equipped.hand2": false});
            }
        }
        // If we are equipping in a hand slot and the other hand slot has a size 2, unequip it
        if (this.actor.system.equipped.hand1 && this.actor.system.equipped.hand1.system.size === 2 && equipSlot === "hand2") {
            await this.actor.update({"system.equipped.hand1": false});
        }
        if (this.actor.system.equipped.hand2 && this.actor.system.equipped.hand2.system.size === 2 && equipSlot === "hand1") {
            await this.actor.update({"system.equipped.hand2": false});
        }

        // Equip item
        const actorUpdateKey = "system.equipped." + equipSlot;
        await this.actor.update({[actorUpdateKey]: item});
    }

    async _onShowItem(event) {
        const element = $(event.currentTarget).parents(".item");
        const item = this.actor.items.get(element.data("itemId"));
        let speaker = ChatMessage.getSpeaker();
        let template = "systems/foundryvtt-fire-sword-and-sorcery/template/chat/item-chat.html";
        let resultData = {
            name: item.name, 
            description: item.system.description,
            type: item.type
        };

        if (item.type === "facet") {
            template = "systems/foundryvtt-fire-sword-and-sorcery/template/chat/facet-chat.html";
            resultData.tier = item.system.tier;
        }

        let result = await renderTemplate(template, resultData);

        let messageData = {
            speaker: speaker,
            content: result,
            type: CONST.CHAT_MESSAGE_TYPES.ROLL,
        }
        CONFIG.ChatMessage.documentClass.create(messageData, {})
    }

    async _onItemDelete(event) {
        const element = $(event.currentTarget).parents(".item");
        await this.actor.deleteEmbeddedDocuments("Item", [element.data("itemId")]);
        element.slideUp(200, () => this.render(false));
    }

    async _onItemRoll(event)  {
        const target = event.currentTarget;
        const rollAttribute = target && target.dataset && target.dataset.rollattribute;

        if (!rollAttribute) {
            console.error("FSS | No roll attribute on target");
            return;
        }
        const attributeValue = this.actor.system.attributes[rollAttribute];
        if (attributeValue === undefined) {
            console.error(`FSS | No attribute key ${rollAttribute} on actor ${this.actor.name}`);
            return;
        }
        
        this.rollPopUp(rollAttribute, attributeValue);
    }

    rollPopUp(rollAttribute, attributeValue) {
        const attributeDict = {
            "str": "Strength",
            "ref": "Reflex",
            "int": "Intelligence",
            "wis": "Wisdom"
        };

        let content = `<form>
            <h1>${attributeDict[rollAttribute]} (+${attributeValue})</h1>
            <select name="facet" id="facet">
            <option value="0">-- No Facet --</option>
            ${this.actor.system.facets.map(facet => {
                return `<option value="${facet.system.tier}">
                    ${facet.name} (${facet.system.tier}): ${facet.system.description}
                    </option>`
            }).join('')}
            </select>
            </form>`;

        new Dialog({
            title: "Roll",
            content: content,
            buttons: {
                yes: {
                    label: "Roll",
                    callback: async (html) => {
                        const facetValue = html.find('[name=facet]')[0].value;
                        const rollFormula = `1d20 + @facetValue + @attributeValue`;

                        const rollData = {
                            facetValue: facetValue,
                            attributeValue: attributeValue
                        };
                        const messageData = {
                            speaker: ChatMessage.getSpeaker()
                        };

                        let r = await new Roll(rollFormula, rollData).roll();
                        r.toMessage(messageData);
                    }
                },
                no: {
                    label: "Close",
                }
            },
            default: "yes",
        }).render(true);
    }

}

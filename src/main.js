// Axie Fighter Game
const config = {
    type: Phaser.AUTO,
    width: 960,
    height: 540,
    backgroundColor: '#4a8f2b',
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 800 },
            debug: false
        }
    },
    scene: {
        preload: preload,
        create: create,
        update: update
    }
};

const game = new Phaser.Game(config);

let player, npc;
let ground;
let healthBars = {};
let gameState = 'playing';
let helpOverlay;
let helpVisible = false;
let restartText;
let winText;
let controls = {};
let background = {};
let parallaxLayers = [];

function preload() {
    // No external assets to preload; particle texture is generated at runtime.
}

function create() {
    // runtime-generate a tiny white square used for particles & hitboxes
    const particleGfx = this.add.graphics();
    particleGfx.fillStyle(0xffffff, 1);
    particleGfx.fillRect(0, 0, 4, 4);
    particleGfx.generateTexture('particle', 4, 4);
    particleGfx.destroy();

    createBackground(this);
    createGround(this);
    createFighters(this);
    createUI(this);
    setupControls(this);
    createHelpOverlay(this);
}

function update() {
    if (gameState === 'playing') {
        updateParallax();
        updateFighters();
        checkGameEnd();
    }
    
    if (Phaser.Input.Keyboard.JustDown(controls.help)) {
        toggleHelp();
    }
    
    if (gameState === 'over' && Phaser.Input.Keyboard.JustDown(controls.restart)) {
        resetGame(this);
    }
}

function createBackground(scene) {
    background.width = config.width;
    background.height = config.height;
    
    const colors = {
        sky: 0x88c1ff,
        farTrees: 0x2d6a4f,
        midTrees: 0x40916c,
        nearTrees: 0x52b788,
        ground: 0x74c69d,
        light: 0xd8f3dc
    };
    
    const skyLayer = scene.add.graphics();
    skyLayer.fillStyle(colors.sky, 1);
    skyLayer.fillRect(0, 0, background.width, background.height);
    
    const lightRay = scene.add.graphics();
    lightRay.fillStyle(colors.light, 0.3);
    lightRay.fillEllipse(background.width/2, background.height/2, 400, 300);
    
    const farTrees = scene.add.graphics();
    farTrees.fillStyle(colors.farTrees, 1);
    for (let i = 0; i < 15; i++) {
        const x = Phaser.Math.Between(0, background.width);
        const h = Phaser.Math.Between(100, 200);
        const w = Phaser.Math.Between(80, 150);
        farTrees.fillEllipse(x, background.height - h/2, w, h);
    }
    
    const midTrees = scene.add.graphics();
    midTrees.fillStyle(colors.midTrees, 1);
    for (let i = 0; i < 10; i++) {
        const x = Phaser.Math.Between(0, background.width);
        const h = Phaser.Math.Between(150, 250);
        const w = Phaser.Math.Between(100, 180);
        midTrees.fillEllipse(x, background.height - h/2, w, h);
    }
    
    const nearTrees = scene.add.graphics();
    nearTrees.fillStyle(colors.nearTrees, 1);
    for (let i = 0; i < 8; i++) {
        const x = Phaser.Math.Between(0, background.width);
        const h = Phaser.Math.Between(180, 300);
        const w = Phaser.Math.Between(120, 200);
        nearTrees.fillEllipse(x, background.height - h/2, w, h);
    }
    
    parallaxLayers = [
        { layer: farTrees, factor: 0.1 },
        { layer: midTrees, factor: 0.2 },
        { layer: nearTrees, factor: 0.3 }
    ];
}

function updateParallax() {
    if (!player || !player.body) return;
    
    const playerVelocityX = player.body.velocity.x;
    
    parallaxLayers.forEach(item => {
        item.layer.x -= playerVelocityX * item.factor * 0.01;
        
        if (item.layer.x < -background.width) {
            item.layer.x = 0;
        } else if (item.layer.x > background.width) {
            item.layer.x = 0;
        }
    });
}

function createGround(scene) {
    const groundHeight = 60;
    const groundY = config.height - groundHeight/2;
    
    const groundGraphics = scene.add.graphics();
    groundGraphics.fillStyle(0x74c69d, 1);
    groundGraphics.fillRect(0, config.height - groundHeight, config.width, groundHeight);
    
    ground = scene.add.rectangle(config.width/2, groundY, config.width, groundHeight, 0x74c69d);
    scene.physics.add.existing(ground, true);
}

function createFighters(scene) {
    player = new Fighter(scene, 300, config.height - 120, 'player', 0xffa500);
    npc = new Fighter(scene, 660, config.height - 120, 'npc', 0x52b788);
    
    scene.physics.add.collider(player.sprite, ground);
    scene.physics.add.collider(npc.sprite, ground);
    
    scene.physics.add.overlap(
        player.attackHitbox, 
        npc.sprite, 
        () => handleAttackCollision(player, npc)
    );
    
    scene.physics.add.overlap(
        npc.attackHitbox, 
        player.sprite, 
        () => handleAttackCollision(npc, player)
    );
}

function handleAttackCollision(attacker, defender) {
    if (!attacker.isAttacking || defender.isInvulnerable) return;
    
    const attack = attacker.currentAttack;
    if (!attack) return;
    
    if (attack.type === 'high' && defender.isDucking) {
        createDodgeEffect(defender.sprite.x, defender.sprite.y);
        return;
    }
    
    defender.takeDamage(attack.damage);
    createHitEffect(defender.sprite.x, defender.sprite.y);
    
    attacker.isAttacking = false;
}

function createHitEffect(x, y) {
    const scene = game.scene.scenes[0];
    const count = 16;
    for (let i = 0; i < count; i++) {
        const sprite = scene.add.image(x, y, 'particle')
            .setTint(0xff0000)
            .setDepth(25)
            .setScale(1)
            .setAlpha(1);
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
        const distance = Phaser.Math.Between(40, 100);
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance;
        scene.tweens.add({
            targets: sprite,
            x: x + dx,
            y: y + dy,
            alpha: 0,
            scale: 0,
            ease: 'Cubic.easeOut',
            duration: 300,
            onComplete: () => sprite.destroy()
        });
    }
}

function createDodgeEffect(x, y) {
    const scene = game.scene.scenes[0];
    const count = 8;
    for (let i = 0; i < count; i++) {
        const sprite = scene.add.image(x, y, 'particle')
            .setTint(0xffffff)
            .setDepth(25)
            .setScale(1)
            .setAlpha(1);
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
        const distance = Phaser.Math.Between(20, 60);
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance;
        scene.tweens.add({
            targets: sprite,
            x: x + dx,
            y: y + dy,
            alpha: 0,
            scale: 0,
            ease: 'Cubic.easeOut',
            duration: 200,
            onComplete: () => sprite.destroy()
        });
    }
}

function createUI(scene) {
    const barConfig = {
        width: 200,
        height: 20,
        borderWidth: 2,
        x: 20,
        y: 20
    };
    
    healthBars.player = {
        border: scene.add.rectangle(barConfig.x + barConfig.width/2, barConfig.y, barConfig.width + barConfig.borderWidth*2, barConfig.height + barConfig.borderWidth*2, 0x000000),
        fill: scene.add.rectangle(barConfig.x + barConfig.width/2, barConfig.y, barConfig.width, barConfig.height, 0x00ff00)
    };
    
    healthBars.npc = {
        border: scene.add.rectangle(config.width - barConfig.x - barConfig.width/2, barConfig.y, barConfig.width + barConfig.borderWidth*2, barConfig.height + barConfig.borderWidth*2, 0x000000),
        fill: scene.add.rectangle(config.width - barConfig.x - barConfig.width/2, barConfig.y, barConfig.width, barConfig.height, 0x00ff00)
    };
    
    const playerLabel = scene.add.text(barConfig.x, barConfig.y + 25, 'PLAYER', { fontSize: '16px', fill: '#fff' });
    const npcLabel = scene.add.text(config.width - barConfig.x - 80, barConfig.y + 25, 'NPC', { fontSize: '16px', fill: '#fff' });
    
    healthBars.player.border.setDepth(10);
    healthBars.player.fill.setDepth(11);
    healthBars.npc.border.setDepth(10);
    healthBars.npc.fill.setDepth(11);
    playerLabel.setDepth(11);
    npcLabel.setDepth(11);
    
    winText = scene.add.text(config.width/2, config.height/2, '', { 
        fontSize: '48px', 
        fill: '#fff',
        stroke: '#000',
        strokeThickness: 6
    }).setOrigin(0.5).setDepth(20).setVisible(false);
    
    restartText = scene.add.text(config.width/2, config.height/2 + 60, 'Press R to restart', { 
        fontSize: '24px', 
        fill: '#fff',
        stroke: '#000',
        strokeThickness: 4
    }).setOrigin(0.5).setDepth(20).setVisible(false);
}

function updateHealthBar(fighter) {
    const bar = healthBars[fighter.type];
    if (!bar) return;
    
    const healthPercent = fighter.health / fighter.maxHealth;
    const barWidth = 200 * healthPercent;
    
    bar.fill.width = barWidth;
    
    if (fighter.type === 'player') {
        bar.fill.x = 20 + barWidth/2;
    } else {
        bar.fill.x = config.width - 20 - barWidth/2;
    }
    
    if (healthPercent < 0.3) {
        bar.fill.fillColor = 0xff0000;
    } else if (healthPercent < 0.6) {
        bar.fill.fillColor = 0xffff00;
    } else {
        bar.fill.fillColor = 0x00ff00;
    }
}

function setupControls(scene) {
    controls = {
        left: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        right: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        up: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        down: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        punch: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.J),
        kick: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K),
        help: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.H),
        restart: scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R)
    };
}

function createHelpOverlay(scene) {
    helpOverlay = scene.add.container(0, 0).setDepth(30).setVisible(false);
    
    const bg = scene.add.rectangle(config.width/2, config.height/2, config.width, config.height, 0x000000, 0.8);
    
    const title = scene.add.text(config.width/2, 100, 'AXIE FIGHTER CONTROLS', { 
        fontSize: '32px', 
        fill: '#fff' 
    }).setOrigin(0.5);
    
    const controlsText = [
        'A / D - Move left / right',
        'W - Jump',
        'S - Duck',
        'J - Punch',
        'K - Kick',
        'S + J - Duck punch (low attack)',
        'W + K - Jump kick (air attack)',
        '',
        'Ducking avoids high attacks!',
        '',
        'H - Toggle help',
        'R - Restart game (when game over)'
    ];
    
    const controlsDisplay = scene.add.text(config.width/2, 180, controlsText, { 
        fontSize: '24px', 
        fill: '#fff',
        align: 'center',
        lineSpacing: 10
    }).setOrigin(0.5, 0);
    
    const closeText = scene.add.text(config.width/2, config.height - 80, 'Press H to return to game', { 
        fontSize: '24px', 
        fill: '#fff' 
    }).setOrigin(0.5);
    
    helpOverlay.add([bg, title, controlsDisplay, closeText]);
}

function toggleHelp() {
    helpVisible = !helpVisible;
    helpOverlay.setVisible(helpVisible);
    
    if (gameState === 'playing') {
        gameState = helpVisible ? 'paused' : 'playing';
    }
}

function updateFighters() {
    player.update(controls);
    npc.updateAI(player);
    
    updateHealthBar(player);
    updateHealthBar(npc);
}

function checkGameEnd() {
    if (player.health <= 0 || npc.health <= 0) {
        gameState = 'over';
        
        if (player.health <= 0) {
            winText.setText('NPC WINS!');
        } else {
            winText.setText('PLAYER WINS!');
        }
        
        winText.setVisible(true);
        restartText.setVisible(true);
    }
}

function resetGame(scene) {
    player.reset(300, config.height - 120);
    npc.reset(660, config.height - 120);
    
    updateHealthBar(player);
    updateHealthBar(npc);
    
    winText.setVisible(false);
    restartText.setVisible(false);
    
    gameState = 'playing';
}

class Fighter {
    constructor(scene, x, y, type, color) {
        this.scene = scene;
        this.type = type;
        this.color = color;
        
        this.maxHealth = 100;
        this.health = this.maxHealth;
        this.speed = 200;
        this.jumpForce = -500;
        
        this.isAttacking = false;
        this.attackCooldown = 0;
        this.isInvulnerable = false;
        this.invulnerableTime = 0;
        this.isDucking = false;
        this.facingLeft = type === 'npc';
        
        this.createSprite(x, y);
        this.createAttackHitbox();
        
        this.attackTypes = {
            punch: { damage: 10, duration: 300, cooldown: 400, type: 'high', offsetX: 50, offsetY: -10, width: 40, height: 20 },
            kick: { damage: 15, duration: 400, cooldown: 600, type: 'mid', offsetX: 60, offsetY: 0, width: 50, height: 30 },
            duckPunch: { damage: 8, duration: 300, cooldown: 400, type: 'low', offsetX: 50, offsetY: 20, width: 40, height: 20 },
            jumpKick: { damage: 20, duration: 400, cooldown: 600, type: 'high', offsetX: 60, offsetY: -20, width: 50, height: 30 }
        };
        
        this.currentAttack = null;
        
        if (type === 'npc') {
            this.aiState = 'approach';
            this.aiTimer = 0;
            this.aiDecisionTime = Phaser.Math.Between(500, 1500);
        }
    }
    
    createSprite(x, y) {
        const bodyRadius = 30;
        
        const graphics = this.scene.add.graphics();
        graphics.fillStyle(this.color, 1);
        graphics.fillCircle(bodyRadius, bodyRadius, bodyRadius);
        
        graphics.fillStyle(0xffffff, 1);
        graphics.fillCircle(bodyRadius-10, bodyRadius-10, 8);
        graphics.fillCircle(bodyRadius+10, bodyRadius-10, 8);
        
        graphics.fillStyle(0x000000, 1);
        graphics.fillCircle(bodyRadius-10, bodyRadius-10, 4);
        graphics.fillCircle(bodyRadius+10, bodyRadius-10, 4);
        
        graphics.fillStyle(0x000000, 1);
        graphics.fillRect(bodyRadius-15, bodyRadius+5, 30, 5);
        
        graphics.generateTexture(`fighter-${this.type}`, bodyRadius * 2, bodyRadius * 2);
        graphics.destroy();
        
        this.sprite = this.scene.physics.add.sprite(x, y, `fighter-${this.type}`);
        this.sprite.setCircle(bodyRadius);
        this.sprite.setBounce(0.1);
        this.sprite.setCollideWorldBounds(true);
        this.sprite.body.setSize(bodyRadius * 1.5, bodyRadius * 2);
        
        if (this.facingLeft) {
            this.sprite.flipX = true;
        }
        
        this.normalHeight = this.sprite.body.height;
        this.duckHeight = this.normalHeight * 0.6;
    }
    
    createAttackHitbox() {
        this.attackHitbox = this.scene.physics.add.image(0, 0, 'particle');
        this.attackHitbox.setVisible(false);
        this.attackHitbox.setAlpha(0);
        this.attackHitbox.setActive(false);
        this.attackHitbox.body.allowGravity = false;
    }
    
    update(controls) {
        if (this.type !== 'player' || gameState !== 'playing') return;
        
        this.handleMovement(controls);
        this.handleAttacks(controls);
        this.updateTimers();
        this.updateAttackHitbox();
    }
    
    updateAI(player) {
        if (this.type !== 'npc' || gameState !== 'playing') return;
        
        this.aiTimer += this.scene.game.loop.delta;
        
        if (this.aiTimer >= this.aiDecisionTime) {
            this.makeAIDecision(player);
            this.aiTimer = 0;
            this.aiDecisionTime = Phaser.Math.Between(500, 1500);
        }
        
        this.executeAIAction(player);
        this.updateTimers();
        this.updateAttackHitbox();
    }
    
    makeAIDecision(player) {
        const distanceToPlayer = Math.abs(this.sprite.x - player.sprite.x);
        const randomChoice = Math.random();
        
        if (distanceToPlayer > 200) {
            this.aiState = 'approach';
        } else if (distanceToPlayer < 100) {
            if (randomChoice < 0.3) {
                this.aiState = 'retreat';
            } else if (randomChoice < 0.7) {
                this.aiState = 'attack';
            } else {
                this.aiState = 'jump';
            }
        } else {
            if (randomChoice < 0.6) {
                this.aiState = 'attack';
            } else if (randomChoice < 0.8) {
                this.aiState = 'jump';
            } else {
                this.aiState = 'duck';
            }
        }
        
        if (player.isAttacking && randomChoice > 0.5) {
            this.aiState = 'duck';
        }
    }
    
    executeAIAction(player) {
        const moveLeft = this.sprite.x > player.sprite.x;
        this.facingLeft = moveLeft;
        this.sprite.flipX = moveLeft;
        
        switch (this.aiState) {
            case 'approach':
                this.sprite.setVelocityX(moveLeft ? -this.speed : this.speed);
                break;
                
            case 'retreat':
                this.sprite.setVelocityX(moveLeft ? this.speed : -this.speed);
                break;
                
            case 'attack':
                if (!this.isAttacking && this.attackCooldown <= 0) {
                    const attackChoice = Math.random();
                    
                    if (attackChoice < 0.5) {
                        this.attack('punch');
                    } else {
                        this.attack('kick');
                    }
                }
                break;
                
            case 'jump':
                if (this.isGrounded()) {
                    this.sprite.setVelocityY(this.jumpForce);
                    
                    if (Math.random() > 0.5) {
                        this.attack('jumpKick');
                    }
                }
                break;
                
            case 'duck':
                this.duck(true);
                
                if (Math.random() > 0.7 && !this.isAttacking) {
                    this.attack('duckPunch');
                }
                break;
        }
    }
    
    handleMovement(controls) {
        if (this.isAttacking) {
            this.sprite.setVelocityX(0);
            return;
        }
        
        if (controls.left.isDown) {
            this.sprite.setVelocityX(-this.speed);
            this.facingLeft = true;
            this.sprite.flipX = true;
        } else if (controls.right.isDown) {
            this.sprite.setVelocityX(this.speed);
            this.facingLeft = false;
            this.sprite.flipX = false;
        } else {
            this.sprite.setVelocityX(0);
        }
        
        if (controls.up.isDown && this.isGrounded()) {
            this.sprite.setVelocityY(this.jumpForce);
        }
        
        this.duck(controls.down.isDown);
    }
    
    duck(isDucking) {
        if (isDucking && this.isGrounded()) {
            if (!this.isDucking) {
                this.sprite.body.setSize(this.sprite.body.width, this.duckHeight);
                this.sprite.setScale(1, 0.6);
                this.isDucking = true;
            }
        } else if (this.isDucking) {
            this.sprite.body.setSize(this.sprite.body.width, this.normalHeight);
            this.sprite.setScale(1, 1);
            this.isDucking = false;
        }
    }
    
    handleAttacks(controls) {
        if (this.isAttacking || this.attackCooldown > 0) return;
        
        if (controls.punch.isDown) {
            if (controls.down.isDown && this.isDucking) {
                this.attack('duckPunch');
            } else {
                this.attack('punch');
            }
        } else if (controls.kick.isDown) {
            if (controls.up.isDown && !this.isGrounded()) {
                this.attack('jumpKick');
            } else {
                this.attack('kick');
            }
        }
    }
    
    attack(attackType) {
        if (this.isAttacking || this.attackCooldown > 0) return;
        
        this.isAttacking = true;
        this.currentAttack = this.attackTypes[attackType];
        
        this.scene.time.delayedCall(this.currentAttack.duration, () => {
            this.isAttacking = false;
            this.attackCooldown = this.currentAttack.cooldown;
            this.attackHitbox.setActive(false);
            this.attackHitbox.setVisible(false);
        });
    }
    
    updateAttackHitbox() {
        if (this.isAttacking && this.currentAttack) {
            const directionMultiplier = this.facingLeft ? -1 : 1;
            const offsetX = this.currentAttack.offsetX * directionMultiplier;
            
            this.attackHitbox.setPosition(
                this.sprite.x + offsetX,
                this.sprite.y + this.currentAttack.offsetY
            );
            
            this.attackHitbox.setDisplaySize(
                this.currentAttack.width,
                this.currentAttack.height
            );
            
            this.attackHitbox.body.setSize(
                this.currentAttack.width,
                this.currentAttack.height
            );
            
            this.attackHitbox.setActive(true);
            
            if (config.physics.arcade.debug) {
                this.attackHitbox.setVisible(true);
            }
        }
    }
    
    updateTimers() {
        if (this.attackCooldown > 0) {
            this.attackCooldown -= this.scene.game.loop.delta;
        }
        
        if (this.isInvulnerable) {
            this.invulnerableTime -= this.scene.game.loop.delta;
            
            if (this.invulnerableTime <= 0) {
                this.isInvulnerable = false;
                this.sprite.alpha = 1;
            }
        }
    }
    
    takeDamage(amount) {
        if (this.isInvulnerable) return;
        
        this.health = Math.max(0, this.health - amount);
        
        this.isInvulnerable = true;
        this.invulnerableTime = 500;
        
        this.sprite.alpha = 0.5;
        
        const knockbackForce = 150;
        const knockbackDirection = this.facingLeft ? 1 : -1;
        this.sprite.setVelocityX(knockbackForce * knockbackDirection);
        
        if (this.health <= 0) {
            this.sprite.setTint(0xff0000);
        }
    }
    
    isGrounded() {
        return this.sprite.body.touching.down || this.sprite.body.blocked.down;
    }
    
    reset(x, y) {
        this.sprite.setPosition(x, y);
        this.sprite.setVelocity(0, 0);
        this.sprite.clearTint();
        this.sprite.alpha = 1;
        
        this.health = this.maxHealth;
        this.isAttacking = false;
        this.attackCooldown = 0;
        this.isInvulnerable = false;
        this.invulnerableTime = 0;
        this.isDucking = false;
        
        this.duck(false);
        
        if (this.type === 'npc') {
            this.aiState = 'approach';
            this.aiTimer = 0;
        }
    }
}

"""Listas dos minigames da call: temas do Impostor e da Forca, e as palavras de 5 letras da Quina.

Escritas à mão para o jogo. Só o servidor lê estas listas: a palavra sorteada nunca vai para
o app de quem não deveria ver.
"""

from __future__ import annotations

import unicodedata


def plain(s: str) -> str:
    """Sem acento, minúsculo: "Ação" -> "acao"."""
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()


TEMAS: dict[str, dict] = {
    "lugares": {
        "nome": "Lugares",
        "palavras": [
            "Praia", "Hospital", "Escola", "Aeroporto", "Cinema", "Shopping", "Academia", "Igreja", "Restaurante",
            "Biblioteca", "Supermercado", "Estádio", "Zoológico", "Parque de diversões", "Delegacia", "Padaria",
            "Farmácia", "Hotel", "Navio", "Avião", "Ônibus", "Metrô", "Fazenda", "Acampamento", "Museu", "Circo",
            "Prisão", "Banco", "Posto de gasolina", "Festa junina", "Casamento", "Show de rock",
            "Lan house", "Barbearia", "Salão de beleza", "Estação espacial", "Submarino", "Castelo", "Cemitério",
        ],
    },
    "comidas": {
        "nome": "Comidas",
        "palavras": [
            "Pizza", "Hambúrguer", "Lasanha", "Feijoada", "Sushi", "Coxinha", "Pastel", "Brigadeiro", "Pão de queijo",
            "Churrasco", "Açaí", "Tapioca", "Pipoca", "Sorvete", "Miojo", "Macarrão", "Strogonoff", "Cuscuz",
            "Acarajé", "Pudim", "Panqueca", "Cachorro-quente", "Esfiha", "Batata frita", "Omelete", "Salada",
            "Moqueca", "Bolo de cenoura", "Quindim", "Ramen", "Taco", "Paçoca", "Torta de limão", "Empada", "Waffle",
        ],
    },
    "animais": {
        "nome": "Animais",
        "palavras": [
            "Cachorro", "Gato", "Elefante", "Girafa", "Leão", "Tigre", "Macaco", "Cavalo", "Vaca", "Galinha",
            "Pinguim", "Tubarão", "Golfinho", "Baleia", "Jacaré", "Cobra", "Tartaruga", "Coruja", "Papagaio",
            "Capivara", "Tamanduá", "Preguiça", "Onça", "Lobo", "Raposa", "Coelho", "Hamster", "Polvo", "Camelo",
            "Canguru", "Panda", "Urso polar", "Zebra", "Abelha", "Formiga", "Borboleta", "Morcego", "Flamingo",
        ],
    },
    "profissoes": {
        "nome": "Profissões",
        "palavras": [
            "Médico", "Professor", "Bombeiro", "Policial", "Cozinheiro", "Motorista", "Piloto", "Astronauta",
            "Dentista", "Advogado", "Pedreiro", "Eletricista", "Encanador", "Programador", "Youtuber", "Streamer",
            "Jogador de futebol", "Cantor", "Ator", "Fotógrafo", "Garçom", "Barbeiro", "Veterinário", "Enfermeiro",
            "Jornalista", "Mecânico", "Padeiro", "Carteiro", "Juiz", "Detetive", "Mágico", "Palhaço", "Faxineiro",
        ],
    },
    "objetos": {
        "nome": "Objetos",
        "palavras": [
            "Celular", "Geladeira", "Televisão", "Controle remoto", "Travesseiro", "Escova de dente", "Guarda-chuva",
            "Mochila", "Relógio", "Óculos", "Tesoura", "Martelo", "Vassoura", "Espelho", "Ventilador",
            "Micro-ondas", "Liquidificador", "Fone de ouvido", "Teclado", "Mouse", "Cadeira gamer", "Videogame",
            "Lanterna", "Chave", "Carteira", "Caneta", "Caderno", "Bicicleta", "Skate", "Violão", "Panela", "Toalha",
        ],
    },
    "esportes": {
        "nome": "Esportes",
        "palavras": [
            "Futebol", "Vôlei", "Basquete", "Natação", "Tênis", "Boxe", "Judô", "Surfe", "Skate", "Ciclismo",
            "Corrida", "Handebol", "Futsal", "Xadrez", "Beisebol", "Golfe", "Esgrima", "Ginástica", "Capoeira",
            "Jiu-jítsu", "Escalada", "Boliche", "Sinuca", "Pingue-pongue", "Automobilismo", "Paraquedismo",
        ],
    },
    "games": {
        "nome": "Coisas de games",
        "palavras": [
            "Chefão", "Checkpoint", "Respawn", "Inventário", "Poção de vida", "Mapa", "Missão secundária",
            "Easter egg", "Speedrun", "Lag", "Modo história", "Multiplayer", "Loot", "Baú", "Espada lendária",
            "Escudo", "Arco e flecha", "Granada", "Fase de gelo", "Fase de lava", "Tutorial", "Game over",
            "Conquista", "Skin", "Battle royale", "Ranqueada", "Controle", "Cartucho", "Fliperama", "NPC",
        ],
    },
    "anime": {
        "nome": "Coisas de anime",
        "palavras": [
            "Abertura", "Encerramento", "Filler", "Mangá", "Cosplay", "Ninja", "Samurai", "Espada", "Escola",
            "Torneio", "Transformação", "Poder oculto", "Mestre", "Rival", "Vilão", "Dragão", "Robô gigante",
            "Isekai", "Festival escolar", "Onigiri", "Ramen", "Templo", "Sakura", "Episódio de praia",
            "Flashback", "Treinamento", "Grito de ataque", "Convenção", "Dublagem", "Temporada nova",
        ],
    },
}

# Quina: palavras de 5 letras (sem contar acento), comuns, para dar para acertar jogando em grupo.
_QUINA = """
abrir acaso achar adeus agora aguia ainda alado algum altar aluno amado amigo andar anexo anjos antes
apoio areia arroz assar atlas atual aviao bacia baile baixo balde banco banda barba barco barro beber
bicho bispo bloco bolha bolso bomba borda botas braco brasa breve brisa bruxa burro cabos cacau caixa
calda calma calor camas campo canal canoa canto capim capuz carga carne carro carta casal casca caule
cavar cedro cenas certo cesta chapa chave chefe cheio chuva cinco cinto circo cisne claro cobra coisa
combo conde conto copos coral corpo corte couro cravo crime cruel cubos culpa curso curto dados danca
dardo datas dedos delta denso dente deusa dicas digno disco doces dores drama duelo dupla durar eixos
enfim entao entre envio erros etapa exame facas facil faixa falar falso farol fatia fazer feira feliz
fenda feras festa fibra ficar filho firma fogos folha fonte forca forma forno forte fraco frase frete
frevo fruta fugir fundo furia fusao gaita galho ganho garfo garra gatos gemer genio gesso girar globo
golpe gordo gosto grade grato grave greve grilo grito grupo guiar haste hotel humor ideia idolo igual
ilhas imune irmao janta jeito jogar jogos joias jovem juizo junho junto justo lagoa lapis largo laser
latas lavar leite lenda lento leque letra levar libra licao lidar limao limpo lindo linha lista livre
livro lobos local lojas longe lotes louca lugar lunar luzes macio magia magro maior malha manga manha
mania manso mapas marca marco massa matar medos meias meios melao menor menta mesas metal metro mexer
milho mimos minas miolo mirar misto modas moeda molho monge morro morte mosca motor mudar muito mural
museu nadar nariz navio negar nervo ninja nivel noite norte notas novas nuvem obras odiar oeste olhar
ombro ondas opcao orcas ordem ostra outro ouvir pacto padre pagar palco palha panda papel parar parte
passo pasta patas pausa pavao pecas pedal pedra peixe pelos penas pente perda perto pesar pesca piano
picos pilha pingo pinha pipas pique pisar pista pizza plano pneus poder poema poeta polvo pombo ponte
porco porta posse poste potes pouco praca prado praia prato prazo preco preto prima prova pular pulso
punho quase queda quilo raios ramos rampa rapaz raros reais redes regra reino remar resto retro rever
rimas risco ritmo robos rocha rodas roupa rubis rugir rumor sabao sabia sabor sacos saida salao salsa
salto samba santo sapos saude secar sedas seiva selva senha sinal sitio sobra socos sofas sogra solto
somar sonho sopro sorte suave subir sujar sumir super surdo susto tacas talco tampa tanto tarde tecla
telas temas tempo tenis terra texto tigre times tinta tiros tocar todos tomar topar torre total touro
traje trama treno trevo tribo trigo troca trono tubos turma turno uniao urnas usina vacas vagao valor
vapor vazio velas velho venda vento verao verbo verde vidas vidro vigor vinho viola viral visao vista
viver vocal volta vulto xampu zebra
""".split()

QUINA: list[str] = sorted({w for w in (plain(x) for x in _QUINA) if len(w) == 5 and w.isascii() and w.isalpha()})
